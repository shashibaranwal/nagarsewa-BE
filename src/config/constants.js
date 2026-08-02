const ROLES = {
  CITIZEN: 'citizen',
  OFFICIAL: 'official',
  ADMIN: 'admin',
};

// Report lifecycle. `untouched` is the state every new report starts in.
const REPORT_STATUS = {
  UNTOUCHED: 'untouched',
  READ: 'read',
  WORKING: 'working',
  COMPLETED: 'completed',
};

const REPORT_CATEGORIES = [
  'pothole',
  'garbage',
  'street_light',
  'water_supply',
  'drainage',
  'road_damage',
  'public_toilet',
  'stray_animals',
  'encroachment',
  'other',
];

const NOTIFICATION_TYPES = {
  NEW_REPORT: 'new_report',
  STATUS_CHANGED: 'status_changed',
  NEW_COMMENT: 'new_comment',
  COMMENT_REPLY: 'comment_reply',
  NEW_VOTE: 'new_vote',
  NEW_REPOST: 'new_repost',
};

module.exports = {
  ROLES,
  REPORT_STATUS,
  REPORT_STATUSES: Object.values(REPORT_STATUS),
  REPORT_CATEGORIES,
  NOTIFICATION_TYPES,
};
