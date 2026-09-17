# Product Roadmap

This is the full feature backlog for the AI call-center booking platform, organized by
tier. It is a **planning document, not a build spec** — nothing here is scheduled or
implemented just by being listed. See [plan.md](plan.md) for the current system's
architecture and [README.md](README.md) for what's actually running today.

## MVP — build first

### 1. AI Voice Receptionist
- 24/7 inbound call answering
- Natural voice conversation
- Caller interruption handling
- Custom greeting
- Business-specific AI voice
- Caller intent detection
- New booking handling
- Rescheduling
- Cancellation
- Booking confirmation
- FAQ answering
- Voicemail capture
- Callback scheduling
- After-hours handling
- Emergency response rules
- Unsupported-request handling

### 2. AI Knowledge Base
- Services and prices
- Business hours
- Locations and directions
- Staff information
- Booking policies
- Cancellation policies
- Preparation instructions
- Frequently asked questions
- Approved answers
- Restricted topics
- Knowledge version history
- Approval before publishing
- Knowledge rollback
- Pronunciation dictionary

### 3. Booking and Calendar Management
- Day, week, and month calendar
- Real-time availability
- Staff schedules
- Breaks and time off
- Holiday schedules
- Service duration
- Booking buffers
- Minimum booking notice
- Maximum booking window
- Staff preference
- Location preference
- Time-zone handling
- Conflict prevention
- Temporary slot holding
- Double-booking protection

### 4. Customer Management
- Customer profile
- Phone and email
- Booking history
- Call history
- Communication history
- Customer notes
- Customer preferences
- Consent records
- Customer tags
- Duplicate detection
- CSV import and export

### 5. Human Handoff
- Warm call transfer
- Department-based routing
- Location-based routing
- Staff-based routing
- Low-confidence transfer
- Angry-customer escalation
- Emergency escalation
- Human-request transfer
- Transfer reason
- Conversation summary before transfer
- Callback creation when staff are unavailable

### 6. Customer Notifications
- SMS booking confirmation
- Email confirmation
- Appointment reminders
- Reschedule link
- Cancellation link
- Preparation instructions
- Directions and location details
- Failed-message alerts
- Delivery status
- Opt-out management

### 7. Call Records
- Call recording
- Recording disclosure
- Call transcript
- AI call summary
- Caller intent
- Call outcome
- Booking linked with call
- Transfer details
- Call duration
- Failed-action record
- Recording retention settings
- Search and filters

### 8. Dashboard
- Calls answered
- Appointments booked
- Bookings changed
- Bookings cancelled
- Transfers
- Missed calls
- After-hours calls
- Booking conversion rate
- AI-attributed booking value
- Upcoming appointments
- Failed calls
- Exceptions requiring staff action

### 9. Exception Management
- Failed booking queue
- Calendar conflict alerts
- Payment failure alerts
- Low-confidence call queue
- Unanswered customer request
- Integration failure
- Manual staff review
- Retry action
- Assign issue to staff
- Resolution history

### 10. Team Management
- Staff profiles
- Services assigned to staff
- Staff availability
- Locations assigned to staff
- Owner role
- Manager role
- Receptionist role
- Staff role
- Billing role
- Custom permissions
- User invitation
- User suspension

### 11. Platform Billing
- Subscription plans
- Free trial controls
- Usage limits
- Voice-minute tracking
- SMS usage tracking
- Phone-number charges
- Overage calculation
- Payment method
- Invoices
- Receipts
- Failed-payment recovery
- Plan upgrade
- Plan downgrade
- Account cancellation

### 12. Security
- Tenant data separation
- Role-based access
- Multi-factor authentication
- Encryption
- Secure session handling
- Audit logs
- API credential protection
- Backup and recovery
- Data export
- Data deletion
- Retention controls
- Suspicious-login alerts

## Growth features — add after MVP works

### 15. Omnichannel Communication
- Two-way SMS
- Website chat agent
- Email inbox
- Missed-call text back
- Web lead forms
- Unified conversation inbox
- Cross-channel conversation history
- Language-based routing

### 16. Payment Features
- Booking deposits
- Full prepayment
- Card-on-file through payment processor
- Outstanding balance payment
- Refunds
- Cancellation charges
- No-show charges
- Payment receipts
- Tax details
- Payment dispute records

### 17. Advanced Scheduling
- Waitlist
- Automatic waitlist offers
- Recurring appointments
- Group bookings
- Capacity limits
- Room booking
- Equipment booking
- Multi-staff services
- Linked appointments
- Round-robin staff assignment
- Manager booking overrides
- Bulk rescheduling

### 18. Workflow Automation
- Event triggers
- Conditional rules
- Automatic messages
- Callback creation
- Staff task assignment
- CRM updates
- Customer tagging
- Payment requests
- Review requests
- Rebooking reminders
- No-show recovery
- Failed-payment workflows
- Approval steps
- Workflow execution history

### 19. Lead and Sales Pipeline
- New inquiry stage
- Qualified lead stage
- Appointment offered
- Booked stage
- Won and lost stages
- Opportunity value
- Lost-reason tracking
- Callback queue
- Lead owner
- Follow-up sequence
- Quote request handoff
- Inactive-customer reactivation

### 20. Customer Portal
- Secure customer login
- Upcoming appointments
- Appointment history
- Rescheduling
- Cancellation
- Digital forms
- Consent forms
- Outstanding balances
- Receipts
- Waitlist preferences
- Communication preferences
- Data-access requests

### 21. Advanced Analytics
- Call funnel
- Service performance
- Staff performance
- Location performance
- After-hours performance
- No-show rate
- Cancellation rate
- Average booking value
- Customer lifetime value
- Conversation sentiment
- Common caller questions
- Common objections
- Agent quality score
- Scheduled reports
- CSV export

### 22. Multi-Location Management
- Separate location hours
- Separate phone numbers
- Location-specific services
- Location-specific staff
- Location-specific calendars
- Location-specific AI greetings
- Regional dashboard
- Central owner dashboard
- Cross-location booking

### 23. Integrations
- Google Calendar
- Microsoft Outlook
- Stripe
- Square
- HubSpot
- Salesforce
- GoHighLevel
- Zapier
- Make
- Google Meet
- Zoom
- WhatsApp Business
- Webhooks

### 24. API and Developer Tools
- OAuth connections
- Scoped API keys
- REST API
- Webhook subscriptions
- Signed webhook payloads
- Retry handling
- Webhook logs
- Data mapping
- Integration health monitoring
- Rate limits
- Developer sandbox

## Enterprise features — sell at higher prices

### 25. White-Label Platform
- Client logo
- Client colors
- Custom domain
- Branded customer portal
- Branded emails
- Branded SMS templates
- Custom AI agent identity
- Partner reseller accounts

### 26. Enterprise Access Controls
- Single sign-on
- SAML
- OIDC
- SCIM provisioning
- Custom roles
- Approval workflows
- Parent and child organizations
- Regional administration
- Franchise administration

### 27. Enterprise Telephony
- Bring-your-own phone number
- Number porting
- Bring-your-own carrier
- Advanced call routing
- Overflow routing
- Failover routing
- Multiple AI agents
- Department-specific agents
- Call queues

### 28. Compliance Controls
- AI disclosure settings
- Call-recording consent
- Consent evidence
- Marketing opt-in records
- Do Not Call controls
- Data retention policies
- Sensitive-data redaction
- CCPA request workflow
- HIPAA preparation controls
- Legal hold
- Audit export
- Subprocessor records

### 29. Platform Operator Console
- Company directory
- Tenant status
- Plan management
- Usage monitoring
- Feature flags
- Account suspension
- Tenant support access
- System incident management
- Fraud review
- Cost monitoring
- Profit margin monitoring
- Provider health
- Data deletion queue
- Backup status
- Customer announcements

### 30. Reliability Features
- System health dashboard
- Call latency monitoring
- Booking API monitoring
- Calendar sync monitoring
- Provider outage detection
- Automatic retry
- Dead-letter queue
- Fallback voicemail
- Fallback callback
- Disaster recovery
- Provider failover
- Status notifications

## Ruthless product priority

First release should focus on five jobs:

1. Answer calls
2. Provide approved information
3. Check live availability
4. Complete booking actions
5. Transfer exceptions safely

Do not waste the first release on white-label features, native mobile apps, dozens of
integrations, advanced CRM, or outbound sales calls. A pretty dashboard with unreliable
booking actions is trash. Booking accuracy, call quality, response speed, safe failure,
and measurable appointment value should come first.
