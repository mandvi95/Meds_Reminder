from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import db
from models import User, FamilyLink

family_bp = Blueprint('family', __name__)


@family_bp.route('', methods=['GET'])
@jwt_required()
def list_family():
    user_id = int(get_jwt_identity())
    links = FamilyLink.query.filter_by(owner_id=user_id).all()
    return jsonify({'family': [l.to_dict() for l in links]}), 200


@family_bp.route('/invite', methods=['POST'])
@jwt_required()
def invite_member():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    if not data or not data.get('email'):
        return jsonify({'error': 'Email is required'}), 400

    if data['email'] == User.query.get(user_id).email:
        return jsonify({'error': 'You cannot add yourself'}), 400

    member = User.query.filter_by(email=data['email']).first()
    if not member:
        return jsonify({'error': 'No user found with that email. Ask them to register first.'}), 404

    existing = FamilyLink.query.filter_by(owner_id=user_id, member_id=member.id).first()
    if existing:
        return jsonify({'error': 'This person is already in your family group'}), 409

    role = data.get('role', 'member')
    if role not in ('member', 'support'):
        role = 'member'

    link = FamilyLink(owner_id=user_id, member_id=member.id, role=role)
    db.session.add(link)
    db.session.commit()
    return jsonify({'link': link.to_dict()}), 201


@family_bp.route('/<int:link_id>', methods=['PUT'])
@jwt_required()
def update_role(link_id):
    user_id = int(get_jwt_identity())
    link = FamilyLink.query.filter_by(id=link_id, owner_id=user_id).first_or_404()
    data = request.get_json()

    if data.get('role') in ('member', 'support'):
        link.role = data['role']
        db.session.commit()

    return jsonify({'link': link.to_dict()}), 200


@family_bp.route('/<int:link_id>', methods=['DELETE'])
@jwt_required()
def remove_member(link_id):
    user_id = int(get_jwt_identity())
    link = FamilyLink.query.filter_by(id=link_id, owner_id=user_id).first_or_404()
    db.session.delete(link)
    db.session.commit()
    return jsonify({'message': 'Member removed'}), 200


@family_bp.route('/my-families', methods=['GET'])
@jwt_required()
def my_families():
    """Returns families this user is a member of (not owner)."""
    user_id = int(get_jwt_identity())
    links = FamilyLink.query.filter_by(member_id=user_id).all()
    result = []
    for link in links:
        result.append({
            'id': link.id,
            'owner_id': link.owner_id,
            'owner_name': link.owner.name,
            'owner_email': link.owner.email,
            'role': link.role
        })
    return jsonify({'families': result}), 200
