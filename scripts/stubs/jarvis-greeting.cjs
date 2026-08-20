'use strict';
exports.dayPartFromHour = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
exports.JARVIS_SUGGESTIONS = [
  { id: 'priority-email', label: 'Find important emails', prompt: 'Find my top priority emails.' },
  { id: 'pending-work', label: 'Show pending work', prompt: 'Show my pending approvals and what needs attention.' },
  { id: 'important-today', label: "What's important today?", prompt: "What's important for me today across email and approvals?" },
];
