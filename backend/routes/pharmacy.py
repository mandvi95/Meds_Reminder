from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import db
from models import Order

pharmacy_bp = Blueprint('pharmacy', __name__)

# Mock medicine catalog
MEDICINE_CATALOG = [
    {'id': 1, 'name': 'Paracetamol 500mg', 'category': 'Pain Relief', 'price': '₹25', 'available': True},
    {'id': 2, 'name': 'Amoxicillin 250mg', 'category': 'Antibiotic', 'price': '₹85', 'available': True},
    {'id': 3, 'name': 'Metformin 500mg', 'category': 'Diabetes', 'price': '₹45', 'available': True},
    {'id': 4, 'name': 'Atorvastatin 10mg', 'category': 'Cholesterol', 'price': '₹110', 'available': True},
    {'id': 5, 'name': 'Omeprazole 20mg', 'category': 'Acidity', 'price': '₹60', 'available': True},
    {'id': 6, 'name': 'Amlodipine 5mg', 'category': 'Blood Pressure', 'price': '₹55', 'available': True},
    {'id': 7, 'name': 'Cetirizine 10mg', 'category': 'Allergy', 'price': '₹30', 'available': True},
    {'id': 8, 'name': 'Aspirin 75mg', 'category': 'Heart', 'price': '₹20', 'available': True},
    {'id': 9, 'name': 'Vitamin D3 1000IU', 'category': 'Supplement', 'price': '₹150', 'available': True},
    {'id': 10, 'name': 'Vitamin B12 500mcg', 'category': 'Supplement', 'price': '₹120', 'available': True},
    {'id': 11, 'name': 'Ibuprofen 400mg', 'category': 'Pain Relief', 'price': '₹35', 'available': True},
    {'id': 12, 'name': 'Azithromycin 500mg', 'category': 'Antibiotic', 'price': '₹95', 'available': True},
    {'id': 13, 'name': 'Losartan 50mg', 'category': 'Blood Pressure', 'price': '₹75', 'available': True},
    {'id': 14, 'name': 'Glimepiride 1mg', 'category': 'Diabetes', 'price': '₹65', 'available': True},
    {'id': 15, 'name': 'Pantoprazole 40mg', 'category': 'Acidity', 'price': '₹70', 'available': True},
]


@pharmacy_bp.route('/search', methods=['GET'])
@jwt_required()
def search_medicines():
    query = request.args.get('q', '').lower()
    category = request.args.get('category', '').lower()

    results = MEDICINE_CATALOG
    if query:
        results = [m for m in results if query in m['name'].lower()]
    if category:
        results = [m for m in results if category in m['category'].lower()]

    return jsonify({'medicines': results, 'total': len(results)}), 200


@pharmacy_bp.route('/order', methods=['POST'])
@jwt_required()
def place_order():
    user_id = int(get_jwt_identity())
    data = request.get_json()

    if not data or not data.get('medicine_name'):
        return jsonify({'error': 'Medicine name is required'}), 400

    order = Order(
        user_id=user_id,
        medicine_name=data['medicine_name'],
        quantity=data.get('quantity', 1),
        dosage_form=data.get('dosage_form', ''),
        notes=data.get('notes', ''),
        status='pending'
    )
    db.session.add(order)
    db.session.commit()
    return jsonify({'order': order.to_dict()}), 201


@pharmacy_bp.route('/orders', methods=['GET'])
@jwt_required()
def get_orders():
    user_id = int(get_jwt_identity())
    orders = Order.query.filter_by(user_id=user_id).order_by(Order.created_at.desc()).all()
    return jsonify({'orders': [o.to_dict() for o in orders]}), 200


@pharmacy_bp.route('/orders/<int:order_id>', methods=['DELETE'])
@jwt_required()
def cancel_order(order_id):
    user_id = int(get_jwt_identity())
    order = Order.query.filter_by(id=order_id, user_id=user_id).first_or_404()
    if order.status != 'pending':
        return jsonify({'error': 'Only pending orders can be cancelled'}), 400
    order.status = 'cancelled'
    db.session.commit()
    return jsonify({'order': order.to_dict()}), 200
