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

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN_SECONDS = Number(process.env.JWT_EXPIRES_IN_SECONDS || 7 * 24 * 60 * 60); // 7 days
const ALLOW_MOCK_OTP = process.env.ALLOW_MOCK_OTP === 'true';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable');
}

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
    if (!payload?.id || !payload?.exp || Date.now() >= payload.exp * 1000) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) throw new Error();
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

function createAuthToken(userId) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return jwt.encode(
    {
      id: userId,
      iat: nowInSeconds,
      exp: nowInSeconds + JWT_EXPIRES_IN_SECONDS
    },
    JWT_SECRET
  );
}

async function resolveTargetUserId(req) {
  const requestedOwnerIdRaw = req.body?.owner_id ?? req.query?.owner_id ?? req.headers['x-owner-id'];
  const requestedOwnerId = requestedOwnerIdRaw ? parseInt(requestedOwnerIdRaw, 10) : null;

  if (!requestedOwnerId || Number.isNaN(requestedOwnerId) || requestedOwnerId === req.user.id) {
    return req.user.id;
  }

  const relation = await prisma.familyMember.findFirst({
    where: {
      owner_id: requestedOwnerId,
      member_id: req.user.id,
      role: 'support'
    }
  });

  if (!relation) {
    const err = new Error('Not authorized to manage this family member account');
    err.status = 403;
    throw err;
  }

  return requestedOwnerId;
}

async function createActivityLog({ ownerUserId, actorUserId, action, details }) {
  try {
    await prisma.activityLog.create({
      data: {
        user_id: ownerUserId,
        family_member_id: ownerUserId === actorUserId ? null : actorUserId,
        action,
        details
      }
    });
  } catch (err) {
    console.error('[ActivityLog Error]', err.message);
  }
}

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

    const response = { message: 'OTP sent via SMS.', email: user.email };
    if (ALLOW_MOCK_OTP) {
      response.mockOtp = otp;
    }
    res.json(response);
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

    const token = createAuthToken(user.id);
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

    const token = createAuthToken(user.id);
    delete user.password;
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    // Generic response to reduce account enumeration risk.
    if (!user) return res.json({ message: 'If the account exists, a reset OTP has been sent.' });
    if (!user.phone) return res.status(400).json({ error: 'Phone number missing on this account' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otp_expiry = new Date(Date.now() + 10 * 60000);
    await prisma.user.update({
      where: { id: user.id },
      data: { otp, otp_expiry }
    });

    if (twilioClient) {
      try {
        await twilioClient.messages.create({
          body: `Your Dose Med password reset code is: ${otp}`,
          from: twilioPhone,
          to: user.phone
        });
      } catch (smsErr) {
        console.error('[Twilio Error]', smsErr.message);
      }
    }

    const response = { message: 'If the account exists, a reset OTP has been sent.' };
    if (ALLOW_MOCK_OTP) response.mockOtp = otp;
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.otp || !user.otp_expiry) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    if (user.otp !== otp || new Date() > user.otp_expiry) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, otp: null, otp_expiry: null }
    });

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = { ...req.user };
  delete user.password;
  res.json({ user });
});

app.put('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { name, phone, currentPassword, newPassword } = req.body || {};
    const updateData = {};

    if (typeof name === 'string') updateData.name = name.trim();
    if (typeof phone === 'string') updateData.phone = phone.trim();

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to update password' });
      }
      const match = await bcrypt.compare(currentPassword, req.user.password);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    if (!Object.keys(updateData).length) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData
    });
    delete updatedUser.password;
    res.json({ user: updatedUser, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FAMILY ───
app.get('/api/family', authMiddleware, async (req, res) => {
  try {
    const family = await prisma.familyMember.findMany({
      where: { owner_id: req.user.id },
      include: { member: true },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      family: family.map(f => ({
        id: f.id,
        role: f.role,
        member_id: f.member_id,
        member_name: f.member.name,
        member_email: f.member.email,
        member_phone: f.member.phone,
        created_at: f.created_at
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/family/my-families', authMiddleware, async (req, res) => {
  try {
    const families = await prisma.familyMember.findMany({
      where: { member_id: req.user.id },
      include: { owner: true },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      families: families.map(f => ({
        id: f.id,
        role: f.role,
        owner_id: f.owner_id,
        owner_name: f.owner.name,
        owner_email: f.owner.email,
        owner_phone: f.owner.phone,
        created_at: f.created_at
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/family/invite', authMiddleware, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = req.body?.role === 'support' ? 'support' : 'member';
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const memberUser = await prisma.user.findUnique({ where: { email } });
    if (!memberUser) return res.status(404).json({ error: 'No user found with this email' });
    if (memberUser.id === req.user.id) return res.status(400).json({ error: 'You cannot add yourself' });

    const existing = await prisma.familyMember.findFirst({
      where: { owner_id: req.user.id, member_id: memberUser.id }
    });
    if (existing) return res.status(400).json({ error: 'This member is already in your family circle' });

    const familyMember = await prisma.familyMember.create({
      data: {
        owner_id: req.user.id,
        member_id: memberUser.id,
        role
      }
    });

    await createActivityLog({
      ownerUserId: req.user.id,
      actorUserId: req.user.id,
      action: 'Added Family Member',
      details: `${memberUser.name} (${memberUser.email}) added as ${role}`
    });

    res.json({ familyMember });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/family/:id', authMiddleware, async (req, res) => {
  try {
    const relationId = parseInt(req.params.id, 10);
    const role = req.body?.role === 'support' ? 'support' : 'member';
    const relation = await prisma.familyMember.findFirst({
      where: { id: relationId, owner_id: req.user.id },
      include: { member: true }
    });
    if (!relation) return res.status(404).json({ error: 'Family member link not found' });

    const updated = await prisma.familyMember.update({
      where: { id: relationId },
      data: { role }
    });

    await createActivityLog({
      ownerUserId: req.user.id,
      actorUserId: req.user.id,
      action: 'Updated Family Role',
      details: `${relation.member.name} role changed to ${role}`
    });

    res.json({ familyMember: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/family/:id', authMiddleware, async (req, res) => {
  try {
    const relationId = parseInt(req.params.id, 10);
    const relation = await prisma.familyMember.findFirst({
      where: { id: relationId, owner_id: req.user.id },
      include: { member: true }
    });
    if (!relation) return res.status(404).json({ error: 'Family member link not found' });

    await prisma.familyMember.delete({ where: { id: relationId } });
    await createActivityLog({
      ownerUserId: req.user.id,
      actorUserId: req.user.id,
      action: 'Removed Family Member',
      details: `${relation.member.name} removed from family circle`
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MEDICINES ───

app.get('/api/medicines', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const medicines = await prisma.medicine.findMany({ where: { user_id: targetUserId } });
    res.json({ medicines });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/medicines', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const data = { ...req.body, user_id: targetUserId };
    delete data.owner_id;
    const medicine = await prisma.medicine.create({ data });

    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Added Medicine',
      details: `Medicine "${medicine.name}" added`
    });

    res.json({ medicine });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/medicines/:id', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const medicineId = parseInt(req.params.id, 10);
    const existing = await prisma.medicine.findFirst({
      where: { id: medicineId, user_id: targetUserId }
    });
    if (!existing) return res.status(404).json({ error: 'Medicine not found' });

    const data = { ...req.body };
    delete data.owner_id;
    const medicine = await prisma.medicine.update({
      where: { id: medicineId },
      data
    });

    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Updated Medicine',
      details: `Medicine "${medicine.name}" updated`
    });

    res.json({ medicine });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/medicines/:id', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const medicineId = parseInt(req.params.id, 10);
    const existing = await prisma.medicine.findFirst({
      where: { id: medicineId, user_id: targetUserId }
    });
    if (!existing) return res.status(404).json({ error: 'Medicine not found' });

    await prisma.medicine.delete({ where: { id: medicineId } });
    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Deleted Medicine',
      details: `Medicine "${existing.name}" deleted`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── REMINDERS ───

app.get('/api/reminders', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const reminders = await prisma.reminder.findMany({
      where: { user_id: targetUserId },
      include: { medicine: true }
    });
    const formatted = reminders.map(r => ({
      ...r,
      medicine_name: r.medicine.name,
      medicine_dosage: r.medicine.dosage
    }));
    res.json({ reminders: formatted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/reminders', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const medicine = await prisma.medicine.findFirst({
      where: { id: Number(req.body.medicine_id), user_id: targetUserId }
    });
    if (!medicine) return res.status(400).json({ error: 'Medicine does not belong to selected account' });

    const nextCall = calculateNextCall(req.body.time, req.body.days_of_week);
    const data = {
      ...req.body,
      user_id: targetUserId,
      next_call_at: nextCall,
      call_status: "pending"
    };
    delete data.owner_id;
    const reminder = await prisma.reminder.create({ data });

    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Added Reminder',
      details: `Reminder for "${medicine.name}" at ${reminder.time}`
    });

    res.json({ reminder });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/reminders/:id', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const reminderId = parseInt(req.params.id, 10);
    const existing = await prisma.reminder.findFirst({
      where: { id: reminderId, user_id: targetUserId },
      include: { medicine: true }
    });
    if (!existing) return res.status(404).json({ error: 'Reminder not found' });

    const data = { ...req.body };
    delete data.owner_id;
    if (data.time) {
      data.next_call_at = calculateNextCall(data.time, data.days_of_week || existing.days_of_week);
      data.call_status = "pending";
    }
    const reminder = await prisma.reminder.update({
      where: { id: reminderId },
      data
    });

    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Updated Reminder',
      details: `Reminder for "${existing.medicine.name}" updated`
    });

    res.json({ reminder });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/reminders/:id', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const reminderId = parseInt(req.params.id, 10);
    const existing = await prisma.reminder.findFirst({
      where: { id: reminderId, user_id: targetUserId },
      include: { medicine: true }
    });
    if (!existing) return res.status(404).json({ error: 'Reminder not found' });

    await prisma.reminder.delete({ where: { id: reminderId } });
    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Deleted Reminder',
      details: `Reminder for "${existing.medicine.name}" at ${existing.time} deleted`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/reminders/:id/test', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const reminderId = parseInt(req.params.id, 10);
    const reminder = await prisma.reminder.findFirst({
      where: { id: reminderId, user_id: targetUserId },
      include: { medicine: true, user: true }
    });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    const results = {
      push: { success: true, message: 'Test notification logged' }
    };

    await createActivityLog({
      ownerUserId: targetUserId,
      actorUserId: req.user.id,
      action: 'Tested Reminder',
      details: `Test run for "${reminder.medicine.name}" reminder`
    });

    res.json({ results });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/logs', authMiddleware, async (req, res) => {
  try {
    const targetUserId = await resolveTargetUserId(req);
    const logs = await prisma.activityLog.findMany({
      where: { user_id: targetUserId },
      include: { family_member: true, user: true },
      orderBy: { created_at: 'desc' },
      take: 200
    });

    const formatted = logs.map(log => ({
      id: log.id,
      action: log.action,
      details: log.details,
      created_at: log.created_at,
      actor_name: log.family_member?.name || log.user?.name || 'Owner'
    }));

    res.json({ logs: formatted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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
  {
    voice: 'Polly.Kajal-Neural',
    language: 'hi-IN'
  },
  'नमस्ते, यह Dose Med है। आपकी दवा ' + reminder.medicine.name + ' लेने का समय हो गया है। ' +
  'यह आपकी खुराक संख्या ' + dosageNumber + ' के लिए रिमाइंडर है। ' + instruction + '। ' +
  '<break time="1s"/>' +
  'अगर आपने दवा ले ली है, 1 दबाएं। ' +
  '5 मिनट बाद याद दिलाने के लिए, 2 दबाएं। ' +
  'आधे घंटे बाद याद दिलाने के लिए, 3 दबाएं। ' +
  'आज की खुराक छोड़ने के लिए, 4 दबाएं।'
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
