from flask import current_app


def make_reminder_call(phone, reminder_id):
    """Place an outbound call via Twilio that plays a TwiML voice message."""
    try:
        from twilio.rest import Client
        client = Client(
            current_app.config['TWILIO_ACCOUNT_SID'],
            current_app.config['TWILIO_AUTH_TOKEN']
        )
        base_url = current_app.config['BASE_URL']
        twiml_url = f'{base_url}/api/twiml/reminder/{reminder_id}'

        call = client.calls.create(
            url=twiml_url,
            from_=current_app.config['TWILIO_PHONE_NUMBER'],
            to=phone
        )
        return True, f'Call initiated: {call.sid}'
    except Exception as e:
        return False, str(e)
