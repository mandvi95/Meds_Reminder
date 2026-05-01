import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'jwt-dev-secret-change-in-production')
    SQLALCHEMY_DATABASE_URI = 'sqlite:///' + os.path.join(os.path.dirname(__file__), '..', 'mycare.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_ACCESS_TOKEN_EXPIRES = False  # Tokens don't expire for MVP

    TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
    TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
    TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER', '')
    BASE_URL = os.environ.get('BASE_URL', 'http://localhost:5000')
    SMS_PROVIDER = os.environ.get('SMS_PROVIDER', 'textbelt')

    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), '..', 'voice_messages')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max upload
