from datetime import datetime
from database import db


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='admin')  # admin, member, support
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    medicines = db.relationship('Medicine', backref='owner', lazy=True, foreign_keys='Medicine.user_id')
    reminders = db.relationship('Reminder', backref='owner', lazy=True, foreign_keys='Reminder.user_id')
    orders = db.relationship('Order', backref='owner', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'phone': self.phone,
            'role': self.role,
            'created_at': self.created_at.isoformat()
        }


class Medicine(db.Model):
    __tablename__ = 'medicines'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    dosage = db.Column(db.String(100), nullable=True)
    frequency = db.Column(db.String(100), nullable=True)
    instructions = db.Column(db.Text, nullable=True)
    start_date = db.Column(db.String(20), nullable=True)
    end_date = db.Column(db.String(20), nullable=True)
    color = db.Column(db.String(20), default='blue')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reminders = db.relationship('Reminder', backref='medicine', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'dosage': self.dosage,
            'frequency': self.frequency,
            'instructions': self.instructions,
            'start_date': self.start_date,
            'end_date': self.end_date,
            'color': self.color,
            'created_at': self.created_at.isoformat()
        }


class Reminder(db.Model):
    __tablename__ = 'reminders'
    id = db.Column(db.Integer, primary_key=True)
    medicine_id = db.Column(db.Integer, db.ForeignKey('medicines.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    time = db.Column(db.String(10), nullable=False)  # HH:MM format
    days_of_week = db.Column(db.String(50), default='1,2,3,4,5,6,7')  # comma-separated 1-7
    notification_type = db.Column(db.String(20), default='push')  # push, sms, call, all
    is_active = db.Column(db.Boolean, default=True)
    voice_file = db.Column(db.String(200), nullable=True)  # filename of uploaded .mp3
    last_triggered = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    logs = db.relationship('ReminderLog', backref='reminder', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'medicine_id': self.medicine_id,
            'medicine_name': self.medicine.name if self.medicine else '',
            'medicine_dosage': self.medicine.dosage if self.medicine else '',
            'user_id': self.user_id,
            'time': self.time,
            'days_of_week': self.days_of_week,
            'notification_type': self.notification_type,
            'is_active': self.is_active,
            'voice_file': self.voice_file,
            'last_triggered': self.last_triggered.isoformat() if self.last_triggered else None,
            'created_at': self.created_at.isoformat()
        }


class FamilyLink(db.Model):
    __tablename__ = 'family_links'
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    member_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    role = db.Column(db.String(20), default='member')  # member, support
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    owner = db.relationship('User', foreign_keys=[owner_id])
    member = db.relationship('User', foreign_keys=[member_id])

    def to_dict(self):
        return {
            'id': self.id,
            'owner_id': self.owner_id,
            'member_id': self.member_id,
            'member_name': self.member.name,
            'member_email': self.member.email,
            'member_phone': self.member.phone,
            'role': self.role,
            'added_at': self.added_at.isoformat()
        }


class Order(db.Model):
    __tablename__ = 'orders'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    medicine_name = db.Column(db.String(200), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    dosage_form = db.Column(db.String(50), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(30), default='pending')  # pending, confirmed, delivered
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'medicine_name': self.medicine_name,
            'quantity': self.quantity,
            'dosage_form': self.dosage_form,
            'notes': self.notes,
            'status': self.status,
            'created_at': self.created_at.isoformat()
        }


class ReminderLog(db.Model):
    __tablename__ = 'reminder_logs'
    id = db.Column(db.Integer, primary_key=True)
    reminder_id = db.Column(db.Integer, db.ForeignKey('reminders.id'), nullable=False)
    triggered_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='sent')  # sent, failed
    channel = db.Column(db.String(20), nullable=True)  # push, sms, call
    message = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'reminder_id': self.reminder_id,
            'triggered_at': self.triggered_at.isoformat(),
            'status': self.status,
            'channel': self.channel,
            'message': self.message
        }
