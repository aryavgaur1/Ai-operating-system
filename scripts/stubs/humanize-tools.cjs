'use strict';
exports.humanToolLabel = (t,a) => (a && /search/i.test(a) ? 'Checking ' : '') + (t||'tool');
exports.humanToolStart = (t) => "I'm checking your " + t + ".";
exports.humanToolResult = (t,_,ok) => ok ? 'Finished with ' + t : 'Failed';
exports.shouldAutoSpeakReply = (r) => String(r||'').length > 20 && String(r).length < 400;
