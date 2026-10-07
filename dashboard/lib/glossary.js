// Plain-English meaning of the terms the dashboard uses (Jira 25c). Shown as "?" tooltips next to
// the field (components/InfoTip.jsx) and listed together on Settings > Help.
export const GLOSSARY = {
  buffer: ['Buffer time', 'Extra minutes kept free after a service for cleaning up or resting. It is added to the length of every slot, so back-to-back bookings never overlap.'],
  cutoff: ['Change cutoff', 'How long before an appointment a customer can still change or cancel it by phone, link or the My appointments page. After that they have to call the business.'],
  minNotice: ['Minimum notice', 'How soon from now a customer may book. 60 means nobody can book an appointment starting in less than an hour.'],
  bookingWindow: ['Booking window', 'How far ahead customers may book, in days. Leave empty for no limit.'],
  reviewLink: ['Google review link', 'The web address where customers can leave you a Google review. We text it once, about 2 hours after a visit, never at night, and never twice within 30 days to the same person.'],
  retention: ['Retention', 'How many days call recordings and transcripts are kept before they are erased. The call itself (when, how long, how it ended) is always kept.'],
  transferNumber: ['Fallback transfer number', 'Where the AI sends a call when it cannot help and no department or staff number applies. Usually the front desk.'],
  departments: ['Call transfer', 'Which phone number the AI hands a call to for each kind of request, for example billing questions to the office and emergencies to the on-call mobile.'],
  knowledge: ['What your AI should know', 'Opening hours, prices, parking, policies and common answers. The AI reads this during calls, so keep it short and correct.'],
  listing: ['Directory listing', 'Lets customers find your business on the public Find a business page. Your booking link works either way.'],
  slug: ['Booking link name', 'The last part of your booking page address, like /book/abc-salon. Changing it breaks links you have already shared.'],
  needsAttention: ['Needs attention', 'Things that went wrong or need a person: a failed booking, a missed callback, a message that did not send.'],
  activityHistory: ['Activity history', 'A record of who changed what in this account and when.'],
  setupGuide: ['Setup guide', 'The short checklist to get your phone line, services and AI voice ready before you go live.'],
  dailyBreak: ['Daily break', 'A fixed time each day when this person cannot be booked, like lunch.'],
  serviceList: ['Services this person does', 'If you tick some services, customers can only book this person for those. Leave it off and they can do everything.'],
};
