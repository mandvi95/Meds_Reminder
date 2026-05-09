require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jwt-simple');
const { PrismaClient } = require('@prisma/client');
const twilio = require('twilio');
const cron = require('node-cron');
const moment = require('moment-timezone');

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Required for Twilio Webhooks

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Twilio Setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
let twilioClient = null;
if (accountSid && accountSid !== 'ACxxx') {
  twilioClient = twilio(accountSid, authToken);
}

// Middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.decode(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) throw new Error();
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper: Calculate next call time for a reminder
function calculateNextCall(timeStr, daysOfWeekStr) {
  // timeStr: "14:00"
  // daysOfWeekStr: "1,2,3,4,5,6,7" (1=Mon, 7=Sun)
  // For simplicity, we just schedule it for the next occurrence of that time today or tomorrow.
  const now = moment();
  const [hour, minute] = timeStr.split(':').map(Number);
  
  let next = moment().set({ hour, minute, second: 0, millisecond: 0 });
  if (next.isBefore(now)) {
    next.add(1, 'days');
  }
  
  // Real implementation would check daysOfWeekStr, but we'll assume daily if they selected it.
  return next.toDate();
}

// ─── AUTHENTICATION ───

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    let existing = await prisma.user.findUnique({ where: { email } });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otp_expiry = new Date(Date.now() + 10 * 60000); // 10 mins

    let user;
    if (existing) {
      if (existing.is_verified) {
        return res.status(400).json({ error: 'Email already registered' });
      } else {
        user = await prisma.user.update({
          where: { email },
          data: { name, phone, password: hashedPassword, otp, otp_expiry }
        });
      }
    } else {
      user = await prisma.user.create({
        data: { name, email, phone, password: hashedPassword, otp, otp_expiry }
      });
    }

    console.log(`[OTP] Generated OTP for ${email}: ${otp}`);

    // Send Real SMS via Twilio
    if (twilioClient && phone) {
      try {
        await twilioClient.messages.create({
          body: `Your Dose Med verification code is: ${otp}`,
          from: twilioPhone,
          to: phone
        });
        console.log(`[Twilio] SMS sent to ${phone}`);
      } catch (smsErr) {
        console.error('[Twilio Error]', smsErr.message);
      }
    }

    res.json({ message: 'OTP sent via SMS.', email: user.email, mockOtp: otp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_verified) return res.status(400).json({ error: 'User already verified' });
    if (user.otp !== otp || new Date() > user.otp_expiry) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { is_verified: true, otp: null, otp_expiry: null }
    });

    const token = jwt.encode({ id: user.id }, JWT_SECRET);
    delete updatedUser.password;
    res.json({ token, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_verified) return res.status(403).json({ error: 'Please verify your email first', email: user.email });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    const token = jwt.encode({ id: user.id }, JWT_SECRET);
    delete user.password;
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = { ...req.user };
  delete user.password;
  res.json({ user });
});

// ─── MEDICINES ───

app.get('/api/medicines', authMiddleware, async (req, res) => {
  const medicines = await prisma.medicine.findMany({ where: { user_id: req.user.id } });
  res.json({ medicines });
});

app.post('/api/medicines', authMiddleware, async (req, res) => {
  const data = { ...req.body, user_id: req.user.id };
  const medicine = await prisma.medicine.create({ data });
  res.json({ medicine });
});

app.put('/api/medicines/:id', authMiddleware, async (req, res) => {
  const medicine = await prisma.medicine.update({
    where: { id: parseInt(req.params.id) },
    data: req.body
  });
  res.json({ medicine });
});

app.delete('/api/medicines/:id', authMiddleware, async (req, res) => {
  await prisma.medicine.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ success: true });
});

// ─── REMINDERS ───

app.get('/api/reminders', authMiddleware, async (req, res) => {
  const reminders = await prisma.reminder.findMany({
    where: { user_id: req.user.id },
    include: { medicine: true }
  });
  const formatted = reminders.map(r => ({
    ...r,
    medicine_name: r.medicine.name,
    medicine_dosage: r.medicine.dosage
  }));
  res.json({ reminders: formatted });
});

app.post('/api/reminders', authMiddleware, async (req, res) => {
  const nextCall = calculateNextCall(req.body.time, req.body.days_of_week);
  const data = { 
    ...req.body, 
    user_id: req.user.id,
    next_call_at: nextCall,
    call_status: "pending"
  };
  const reminder = await prisma.reminder.create({ data });
  res.json({ reminder });
});

app.put('/api/reminders/:id', authMiddleware, async (req, res) => {
  const data = { ...req.body };
  if (data.time) {
    data.next_call_at = calculateNextCall(data.time, data.days_of_week || "");
    data.call_status = "pending";
  }
  const reminder = await prisma.reminder.update({
    where: { id: parseInt(req.params.id) },
    data
  });
  res.json({ reminder });
});

app.delete('/api/reminders/:id', authMiddleware, async (req, res) => {
  await prisma.reminder.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ success: true });
});

// ─── TWILIO IVR WEBHOOKS ───

app.post('/api/ivr/voice', async (req, res) => {
  const { ReminderId } = req.query; // Passed in the webhook URL
  if (!ReminderId) return res.status(400).send('Missing ReminderId');

  const reminder = await prisma.reminder.findUnique({
    where: { id: parseInt(ReminderId) },
    include: { medicine: true }
  });

  const twiml = new twilio.twiml.VoiceResponse();

  if (!reminder) {
    twiml.say('Sorry, an error occurred finding your reminder. Goodbye.');
    return res.type('text/xml').send(twiml.toString());
  }

  // Find dosage number based on how many reminders exist for this medicine
  const allMeds = await prisma.reminder.findMany({
    where: { medicine_id: reminder.medicine_id },
    orderBy: { time: 'asc' }
  });
  const dosageNumber = allMeds.findIndex(r => r.id === reminder.id) + 1;

  // Split instructions (e.g. "Take after breakfast | Take after lunch")
  const instParts = (reminder.medicine.instructions || '').split(' | ');
  const instruction = instParts[dosageNumber - 1] || reminder.medicine.instructions || 'Please take it as prescribed.';

  const gather = twiml.gather({
    numDigits: 1,
    action: BASE_URL + '/api/ivr/response?ReminderId=' + ReminderId,
    method: 'POST'
  });

  gather.say(
    'Hello, this is Dose Med. It is time to take your medicine ' + reminder.medicine.name + '. ' +
    'This is the reminder for your dosage number ' + dosageNumber + '. ' + instruction + '. ' +
    'Press 1 for Medicine taken. Press 2 to Remind after 5 minutes. ' +
    'Press 3 to Remind after 30 minutes. Press 4 to Skip for today.'
  );

  // If no input, loop back
  twiml.redirect(BASE_URL + '/api/ivr/voice?ReminderId=' + ReminderId);

  res.type('text/xml').send(twiml.toString());
});

app.post('/api/ivr/response', async (req, res) => {
  const { ReminderId } = req.query;
  const { Digits } = req.body; // Keypad input from Twilio

  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const reminder = await prisma.reminder.findUnique({ where: { id: parseInt(ReminderId) } });
    if (!reminder) throw new Error('Reminder not found');

    if (Digits === '1') {
      // Taken
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          call_status: 'taken',
          next_call_at: calculateNextCall(reminder.time, reminder.days_of_week)
        }
      });
      twiml.say('Great! Your medicine has been marked as taken. Goodbye!');
    } else if (Digits === '2') {
      // Snooze 5 mins
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          call_status: 'pending',
          next_call_at: moment().add(5, 'minutes').toDate()
        }
      });
      twiml.say('Got it. I will remind you again in 5 minutes. Goodbye!');
    } else if (Digits === '3') {
      // Snooze 30 mins
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          call_status: 'pending',
          next_call_at: moment().add(30, 'minutes').toDate()
        }
      });
      twiml.say('Got it. I will remind you again in 30 minutes. Goodbye!');
    } else if (Digits === '4') {
      // Skipped
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: {
          call_status: 'skipped',
          next_call_at: calculateNextCall(reminder.time, reminder.days_of_week)
        }
      });
      twiml.say('Your medicine has been skipped for today. Goodbye!');
    } else {
      // Invalid input
      twiml.say('Invalid option selected.');
      twiml.redirect(BASE_URL + '/api/ivr/voice?ReminderId=' + ReminderId);
      return res.type('text/xml').send(twiml.toString());
    }
  } catch (err) {
    console.error('[IVR Response Error]', err);
    twiml.say('An error occurred. Goodbye.');
  }

  res.type('text/xml').send(twiml.toString());
});

// ─── CRON SCHEDULER ───
// Runs every minute
cron.schedule('* * * * *', async () => {
  console.log('[CRON] Checking for pending reminders...', new Date().toISOString());
  try {
    const now = new Date();
    // Find reminders where next_call_at is in the past, and status is still pending
    const dueReminders = await prisma.reminder.findMany({
      where: {
        is_active: true,
        call_status: 'pending',
        next_call_at: {
          lte: now
        }
      },
      include: {
        user: true
      }
    });

    for (const reminder of dueReminders) {
      if (!reminder.user.phone) continue;

      console.log(`[CRON] Triggering Call for Reminder ID ${reminder.id} to ${reminder.user.phone}`);

      if (twilioClient) {
        try {
          const call = await twilioClient.calls.create({
            url: BASE_URL + '/api/ivr/voice?ReminderId=' + reminder.id,
            to: reminder.user.phone,
            from: twilioPhone
          });
          console.log(`[Twilio] Call initiated: ${call.sid}`);
          
          // Optionally update call_status to 'calling' to prevent duplicate immediate triggers
          await prisma.reminder.update({
             where: { id: reminder.id },
             data: { next_call_at: moment().add(5, 'minutes').toDate() } // Auto-snooze if unanswered
          });
        } catch (callErr) {
          console.error(`[Twilio Call Error] Reminder ${reminder.id}:`, callErr.message);
        }
      } else {
        console.log(`[CRON Mock] Would call ${reminder.user.phone} for Reminder ID ${reminder.id}`);
        // Auto snooze for local testing without twilio
        await prisma.reminder.update({
             where: { id: reminder.id },
             data: { next_call_at: moment().add(5, 'minutes').toDate() } 
          });
      }
    }
  } catch (err) {
    console.error('[CRON Error]', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Backend running on http://localhost:' + PORT);
});
