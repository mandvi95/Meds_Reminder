from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import db
from models import Medicine, FamilyLink

medicines_bp = Blueprint('medicines', __name__)


def get_accessible_user_ids(current_user_id):
    """Returns list of user IDs current user can access (self + family they support)."""
    links = FamilyLink.query.filter_by(member_id=current_user_id, role='support').all()
    ids = [current_user_id] + [link.owner_id for link in links]
    return ids


@medicines_bp.route('', methods=['GET'])
@jwt_required()
def list_medicines():
    user_id = int(get_jwt_identity())
    target_id = request.args.get('user_id', user_id, type=int)

    # Check access
    if target_id != user_id:
        accessible = get_accessible_user_ids(user_id)
        if target_id not in accessible:
            return jsonify({'error': 'Access denied'}), 403

    medicines = Medicine.query.filter_by(user_id=target_id).order_by(Medicine.created_at.desc()).all()
    return jsonify({'medicines': [m.to_dict() for m in medicines]}), 200


@medicines_bp.route('', methods=['POST'])
@jwt_required()
def create_medicine():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    if not data or not data.get('name'):
        return jsonify({'error': 'Medicine name is required'}), 400

    medicine = Medicine(
        user_id=user_id,
        name=data['name'],
        dosage=data.get('dosage', ''),
        frequency=data.get('frequency', ''),
        instructions=data.get('instructions', ''),
        start_date=data.get('start_date', ''),
        end_date=data.get('end_date', ''),
        color=data.get('color', 'blue')
    )
    db.session.add(medicine)
    db.session.commit()
    return jsonify({'medicine': medicine.to_dict()}), 201


@medicines_bp.route('/<int:med_id>', methods=['PUT'])
@jwt_required()
def update_medicine(med_id):
    user_id = int(get_jwt_identity())
    medicine = Medicine.query.filter_by(id=med_id, user_id=user_id).first_or_404()
    data = request.get_json()

    for field in ['name', 'dosage', 'frequency', 'instructions', 'start_date', 'end_date', 'color']:
        if field in data:
            setattr(medicine, field, data[field])

    db.session.commit()
    return jsonify({'medicine': medicine.to_dict()}), 200


@medicines_bp.route('/<int:med_id>', methods=['DELETE'])
@jwt_required()
def delete_medicine(med_id):
    user_id = int(get_jwt_identity())
    medicine = Medicine.query.filter_by(id=med_id, user_id=user_id).first_or_404()
    db.session.delete(medicine)
    db.session.commit()
    return jsonify({'message': 'Medicine deleted'}), 200
