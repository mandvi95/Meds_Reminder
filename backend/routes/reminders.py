import os
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from database import db
from models import Reminder, Medicine, ReminderLog

reminders_bp = Blueprint('reminders', __name__)

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@reminders_bp.route('', methods=['GET'])
@jwt_required()
def list_reminders():
    user_id = int(get_jwt_identity())
    reminders = Reminder.query.filter_by(user_id=user_id).order_by(Reminder.time).all()
    return jsonify({'reminders': [r.to_dict() for r in reminders]}), 200


@reminders_bp.route('', methods=['POST'])
@jwt_required()
def create_reminder():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    if not data or not data.get('medicine_id') or not data.get('time'):
        return jsonify({'error': 'medicine_id and time are required'}), 400

    medicine = Medicine.query.filter_by(id=data['medicine_id'], user_id=user_id).first()
    if not medicine:
        return jsonify({'error': 'Medicine not found'}), 404

    reminder = Reminder(
        medicine_id=data['medicine_id'],
        user_id=user_id,
        time=data['time'],
        days_of_week=data.get('days_of_week', '1,2,3,4,5,6,7'),
        notification_type=data.get('notification_type', 'push'),
        is_active=data.get('is_active', True)
    )
    db.session.add(reminder)
    db.session.commit()
    return jsonify({'reminder': reminder.to_dict()}), 201


@reminders_bp.route('/<int:rem_id>', methods=['PUT'])
@jwt_required()
def update_reminder(rem_id):
    user_id = int(get_jwt_identity())
    reminder = Reminder.query.filter_by(id=rem_id, user_id=user_id).first_or_404()
    data = request.get_json()

    for field in ['time', 'days_of_week', 'notification_type', 'is_active']:
        if field in data:
            setattr(reminder, field, data[field])

    db.session.commit()
    return jsonify({'reminder': reminder.to_dict()}), 200


@reminders_bp.route('/<int:rem_id>', methods=['DELETE'])
@jwt_required()
def delete_reminder(rem_id):
    user_id = int(get_jwt_identity())
    reminder = Reminder.query.filter_by(id=rem_id, user_id=user_id).first_or_404()
    db.session.delete(reminder)
    db.session.commit()
    return jsonify({'message': 'Reminder deleted'}), 200


@reminders_bp.route('/<int:rem_id>/test', methods=['POST'])
@jwt_required()
def test_reminder(rem_id):
    user_id = int(get_jwt_identity())
    reminder = Reminder.query.filter_by(id=rem_id, user_id=user_id).first_or_404()

    from models import User
    from services.sms_service import send_sms
    from services.call_service import make_reminder_call

    user = User.query.get(user_id)
    medicine = Medicine.query.get(reminder.medicine_id)
    message = f"MyCare Reminder: Time to take {medicine.name}"
    if medicine.dosage:
        message += f" ({medicine.dosage})"

    results = {}
    ntype = reminder.notification_type

    if ntype in ('sms', 'all') and user.phone:
        success, msg = send_sms(user.phone, message)
        results['sms'] = {'success': success, 'message': msg}
    elif ntype in ('sms', 'all'):
        results['sms'] = {'success': False, 'message': 'No phone number on profile'}

    if ntype in ('call', 'all') and user.phone:
        success, msg = make_reminder_call(user.phone, reminder.id)
        results['call'] = {'success': success, 'message': msg}
    elif ntype in ('call', 'all'):
        results['call'] = {'success': False, 'message': 'No phone number on profile'}

    if ntype in ('push', 'all'):
        results['push'] = {'success': True, 'message': 'Push notification sent'}

    log = ReminderLog(
        reminder_id=reminder.id,
        status='sent',
        channel=ntype,
        message='Test notification'
    )
    reminder.last_triggered = datetime.utcnow()
    db.session.add(log)
    db.session.commit()

    return jsonify({'results': results}), 200


@reminders_bp.route('/pending', methods=['GET'])
@jwt_required()
def pending_push():
    """Returns reminders triggered in the last 2 minutes for push notification display."""
    user_id = int(get_jwt_identity())
    two_min_ago = datetime.utcnow() - timedelta(minutes=2)
    logs = ReminderLog.query.join(Reminder).filter(
        Reminder.user_id == user_id,
        ReminderLog.channel == 'push',
        ReminderLog.triggered_at >= two_min_ago
    ).all()
    return jsonify({'pending': [l.to_dict() for l in logs]}), 200


@reminders_bp.route('/<int:rem_id>/voice', methods=['POST'])
@jwt_required()
def upload_voice(rem_id):
    user_id = int(get_jwt_identity())
    reminder = Reminder.query.filter_by(id=rem_id, user_id=user_id).first_or_404()

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Use mp3, wav, ogg, or m4a'}), 400

    filename = secure_filename(f'reminder_{rem_id}_{user_id}.{file.filename.rsplit(".", 1)[1].lower()}')
    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    reminder.voice_file = filename
    db.session.commit()
    return jsonify({'reminder': reminder.to_dict(), 'voice_file': filename}), 200


@reminders_bp.route('/logs', methods=['GET'])
@jwt_required()
def get_logs():
    user_id = int(get_jwt_identity())
    logs = ReminderLog.query.join(Reminder).filter(
        Reminder.user_id == user_id
    ).order_by(ReminderLog.triggered_at.desc()).limit(50).all()
    return jsonify({'logs': [l.to_dict() for l in logs]}), 200
