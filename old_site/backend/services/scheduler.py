from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

scheduler = BackgroundScheduler()


def init_scheduler(app):
    """Initialize and start the reminder scheduler."""
    scheduler.add_job(
        func=lambda: check_reminders(app),
        trigger=IntervalTrigger(minutes=1),
        id='reminder_check',
        replace_existing=True
    )
    scheduler.start()


def check_reminders(app):
    """Check all active reminders and fire notifications for ones due now."""
    with app.app_context():
        from models import Reminder, User, Medicine, ReminderLog
        from database import db
        from services.sms_service import send_sms
        from services.call_service import make_reminder_call

        now = datetime.now()
        current_time = now.strftime('%H:%M')
        current_day = str(now.isoweekday())  # 1=Monday ... 7=Sunday

        reminders = Reminder.query.filter_by(is_active=True).all()

        for reminder in reminders:
            if reminder.time != current_time:
                continue

            days = reminder.days_of_week.split(',')
            if current_day not in days:
                continue

            # Avoid duplicate triggers within the same minute
            if reminder.last_triggered:
                diff = (now - reminder.last_triggered).total_seconds()
                if diff < 60:
                    continue

            user = User.query.get(reminder.user_id)
            medicine = Medicine.query.get(reminder.medicine_id)
            if not user or not medicine:
                continue

            message = f"MyCare Reminder: Time to take {medicine.name}"
            if medicine.dosage:
                message += f" ({medicine.dosage})"

            ntype = reminder.notification_type
            logs = []

            if ntype in ('sms', 'all') and user.phone:
                success, msg = send_sms(user.phone, message)
                logs.append(ReminderLog(
                    reminder_id=reminder.id,
                    status='sent' if success else 'failed',
                    channel='sms',
                    message=msg
                ))

            if ntype in ('call', 'all') and user.phone:
                success, msg = make_reminder_call(user.phone, reminder.id)
                logs.append(ReminderLog(
                    reminder_id=reminder.id,
                    status='sent' if success else 'failed',
                    channel='call',
                    message=msg
                ))

            if ntype in ('push', 'all'):
                # Push notifications are polled by the frontend via /api/reminders/pending
                logs.append(ReminderLog(
                    reminder_id=reminder.id,
                    status='sent',
                    channel='push',
                    message='Push notification queued'
                ))

            reminder.last_triggered = now
            for log in logs:
                db.session.add(log)

        db.session.commit()
