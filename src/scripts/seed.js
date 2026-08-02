/* Seeds a demo dataset: one admin, two officials, three citizens and a handful
   of reports with comments, votes and reposts. Safe to re-run - it clears the
   collections it owns first. */
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const Report = require('../models/Report');
const Comment = require('../models/Comment');
const Vote = require('../models/Vote');
const Repost = require('../models/Repost');
const Notification = require('../models/Notification');
const { ROLES, REPORT_STATUS } = require('../config/constants');

const PLACEHOLDER_IMAGE = `${env.publicBaseUrl}/${env.uploadDir}/sample.jpg`;

async function seed() {
  await connectDB();

  await Promise.all([
    User.deleteMany({}),
    Report.deleteMany({}),
    Comment.deleteMany({}),
    Vote.deleteMany({}),
    Repost.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  const admin = await User.create({
    name: 'Nagar Sewa Admin',
    email: 'admin@nagarsewa.gov.np',
    password: 'admin123',
    role: ROLES.ADMIN,
    city: 'Bhaktapur',
  });

  const officials = await User.create([
    {
      name: 'Sunita Shrestha',
      email: 'sunita@bhaktapur.gov.np',
      password: 'official123',
      role: ROLES.OFFICIAL,
      department: 'Roads & Infrastructure',
      ward: 'Srijana Nagar',
      city: 'Bhaktapur',
    },
    {
      name: 'Ramesh Karki',
      email: 'ramesh@bhaktapur.gov.np',
      password: 'official123',
      role: ROLES.OFFICIAL,
      department: 'Sanitation',
      ward: 'Suryabinayak',
      city: 'Bhaktapur',
    },
  ]);

  const citizens = await User.create([
    { name: 'Anisha Tamang', email: 'anisha@example.com', password: 'user123', ward: 'Srijana Nagar', city: 'Bhaktapur' },
    { name: 'Bikash Thapa', email: 'bikash@example.com', password: 'user123', ward: 'Srijana Nagar', city: 'Bhaktapur' },
    { name: 'Chandra Maharjan', email: 'chandra@example.com', password: 'user123', ward: 'Suryabinayak', city: 'Bhaktapur' },
  ]);

  const reportSeeds = [
    {
      title: 'Large pothole near Srijana Nagar chowk',
      description:
        'A deep pothole has formed right at the turning. Two bikes have already slipped here this week. It fills with water whenever it rains.',
      category: 'pothole',
      address: 'Srijana Nagar chowk, near the pharmacy',
      ward: 'Srijana Nagar',
      coordinates: [85.4298, 27.6721],
      reportedBy: citizens[0],
      status: REPORT_STATUS.WORKING,
    },
    {
      title: 'Garbage not collected for a week',
      description:
        'The collection truck has not come to our lane since last Sunday. The pile has spread onto the footpath and the smell is unbearable.',
      category: 'garbage',
      address: 'Lane 4, Suryabinayak',
      ward: 'Suryabinayak',
      coordinates: [85.4257, 27.6603],
      reportedBy: citizens[2],
      status: REPORT_STATUS.READ,
    },
    {
      title: 'Street light out on the school road',
      description:
        'Both lights on the stretch in front of the school have been dead for a month. Children walking home after tuition have no lighting at all.',
      category: 'street_light',
      address: 'School road, Srijana Nagar',
      ward: 'Srijana Nagar',
      coordinates: [85.4311, 27.6735],
      reportedBy: citizens[1],
      status: REPORT_STATUS.UNTOUCHED,
    },
    {
      title: 'Drain overflowing onto the main road',
      description:
        'The drain cover near the temple is broken and sewage is flowing onto the road. It has been like this for three days.',
      category: 'drainage',
      address: 'Temple road, Suryabinayak',
      ward: 'Suryabinayak',
      coordinates: [85.4242, 27.6591],
      reportedBy: citizens[2],
      status: REPORT_STATUS.COMPLETED,
    },
  ];

  const reports = [];
  for (const seedData of reportSeeds) {
    const official = officials.find((o) => o.ward === seedData.ward) || officials[0];
    const history = [
      { status: REPORT_STATUS.UNTOUCHED, changedBy: seedData.reportedBy._id },
    ];
    if (seedData.status !== REPORT_STATUS.UNTOUCHED) {
      history.push({ status: seedData.status, changedBy: official._id, note: 'Reviewed by ward office' });
    }

    // eslint-disable-next-line no-await-in-loop
    const report = await Report.create({
      title: seedData.title,
      description: seedData.description,
      category: seedData.category,
      image: { url: PLACEHOLDER_IMAGE, filename: 'sample.jpg', mimeType: 'image/jpeg', size: 102400 },
      location: {
        address: seedData.address,
        ward: seedData.ward,
        city: 'Bhaktapur',
        coordinates: { type: 'Point', coordinates: seedData.coordinates },
      },
      reportedBy: seedData.reportedBy._id,
      status: seedData.status,
      statusHistory: history,
      assignedTo: seedData.status === REPORT_STATUS.UNTOUCHED ? undefined : official._id,
      resolvedAt: seedData.status === REPORT_STATUS.COMPLETED ? new Date() : undefined,
    });
    reports.push(report);
  }

  // Votes: everyone upvotes the pothole, a couple of downvotes elsewhere.
  for (const report of reports) {
    for (const voter of [...citizens, ...officials]) {
      if (String(voter._id) === String(report.reportedBy)) continue;
      const value = report.category === 'pothole' || Math.abs(report.title.length % 3) !== 0 ? 1 : -1;
      // eslint-disable-next-line no-await-in-loop
      await Vote.create({ user: voter._id, targetType: 'Report', targetId: report._id, value });
      // eslint-disable-next-line no-await-in-loop
      await Report.updateOne(
        { _id: report._id },
        value === 1 ? { $inc: { upvoteCount: 1, score: 1 } } : { $inc: { downvoteCount: 1, score: -1 } }
      );
    }
  }

  const comment = await Comment.create({
    report: reports[0]._id,
    author: citizens[1]._id,
    body: 'I hit this on my scooter yesterday. Please fix it before the monsoon.',
  });
  const reply = await Comment.create({
    report: reports[0]._id,
    author: officials[0]._id,
    body: 'Noted. A repair crew is scheduled for this week.',
    parent: comment._id,
  });
  await Comment.updateOne({ _id: comment._id }, { $inc: { replyCount: 1 } });
  await Report.updateOne({ _id: reports[0]._id }, { $inc: { commentCount: 2 } });

  await Repost.create({
    report: reports[0]._id,
    user: citizens[2]._id,
    caption: 'This is the third pothole in the same area. Sharing so it gets attention.',
  });
  await Report.updateOne({ _id: reports[0]._id }, { $inc: { repostCount: 1 } });

  console.log('\nSeed complete:');
  console.log(`  users:   ${1 + officials.length + citizens.length}`);
  console.log(`  reports: ${reports.length}`);
  console.log(`  comments: 2, reposts: 1`);
  console.log('\nLogins (password in brackets):');
  console.log(`  admin    ${admin.email} [admin123]`);
  officials.forEach((o) => console.log(`  official ${o.email} [official123]`));
  citizens.forEach((c) => console.log(`  citizen  ${c.email} [user123]`));
  console.log(`\nSample comment ${comment._id} / reply ${reply._id}`);

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
