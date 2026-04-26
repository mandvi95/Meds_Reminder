import requests
from flask import current_app


def send_sms(phone, message):
    """Send SMS via TextBelt (free, 1/day) or Twilio."""
    provider = current_app.config.get('SMS_PROVIDER', 'textbelt')

    if provider == 'twilio':
        return _send_via_twilio(phone, message)
    return _send_via_textbelt(phone, message)


def _send_via_textbelt(phone, message):
    try:
        resp = requests.post('https://textbelt.com/text', {
            'phone': phone,
            'message': message,
            'key': 'textbelt'
        }, timeout=10)
        data = resp.json()
        if data.get('success'):
            return True, 'SMS sent via TextBelt'
        return False, data.get('error', 'TextBelt failed')
    except Exception as e:
        return False, str(e)


def _send_via_twilio(phone, message):
    try:
        from twilio.rest import Client
        client = Client(
            current_app.config['TWILIO_ACCOUNT_SID'],
            current_app.config['TWILIO_AUTH_TOKEN']
        )
        msg = client.messages.create(
            body=message,
            from_=current_app.config['TWILIO_PHONE_NUMBER'],
            to=phone
        )
        return True, f'SMS sent via Twilio: {msg.sid}'
    except Exception as e:
        return False, str(e)
