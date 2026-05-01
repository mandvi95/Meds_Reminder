import os
from flask import Flask, send_from_directory, jsonify, request
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from database import db
from config import Config


def create_app():
    app = Flask(__name__, static_folder='../frontend', static_url_path='')
    app.config.from_object(Config)

    # Extensions
    db.init_app(app)
    JWTManager(app)
    CORS(app)
    Bcrypt(app)

    # Register blueprints
    from routes.auth import auth_bp
    from routes.medicines import medicines_bp
    from routes.reminders import reminders_bp
    from routes.family import family_bp
    from routes.pharmacy import pharmacy_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(medicines_bp, url_prefix='/api/medicines')
    app.register_blueprint(reminders_bp, url_prefix='/api/reminders')
    app.register_blueprint(family_bp, url_prefix='/api/family')
    app.register_blueprint(pharmacy_bp, url_prefix='/api/pharmacy')

    # TwiML endpoint for Twilio voice calls
    @app.route('/api/twiml/reminder/<int:reminder_id>', methods=['GET', 'POST'])
    def twiml_reminder(reminder_id):
        from models import Reminder
        reminder = Reminder.query.get(reminder_id)

        if reminder and reminder.voice_file:
            base_url = app.config['BASE_URL']
            audio_url = f'{base_url}/api/voice/{reminder.voice_file}'
            twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Hello! This is a reminder from MyCare.</Say>
    <Play>{audio_url}</Play>
    <Say voice="alice">Please take your medicine. Have a healthy day!</Say>
</Response>'''
        else:
            medicine_name = ''
            if reminder and reminder.medicine:
                medicine_name = reminder.medicine.name
            twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Hello! This is MyCare. Time to take your medicine {medicine_name}. Please take it now. Have a healthy day!</Say>
</Response>'''

        from flask import Response
        return Response(twiml, mimetype='text/xml')

    # Serve uploaded voice files
    @app.route('/api/voice/<filename>')
    def serve_voice(filename):
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

    # Serve frontend pages
    @app.route('/')
    def index():
        frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
        return send_from_directory(frontend_dir, 'index.html')

    @app.route('/<path:path>')
    def serve_frontend(path):
        frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
        file_path = os.path.join(frontend_dir, path)
        if os.path.exists(file_path):
            return send_from_directory(frontend_dir, path)
        return send_from_directory(frontend_dir, 'index.html')

    # Create DB tables
    with app.app_context():
        db.create_all()

    # Start scheduler
    from services.scheduler import init_scheduler
    init_scheduler(app)

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, port=5000, use_reloader=False)
