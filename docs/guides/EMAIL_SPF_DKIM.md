# Guide: make our emails reach the inbox (SPF, DKIM, DMARC) · Jira AIN-370 (29n)

For the teammate with access to the domain's DNS settings. Allow about 30 minutes, plus up to a few hours for DNS to update.

## Why this matters, in plain words
Our system sends emails: team invitations, sign-in codes, booking confirmations. Mail services such as Gmail and Outlook check whether an email really comes from the address it claims. If we skip the setup below, our emails often land in **spam** or are **silently dropped**, and nobody sees an error. Three small records in the domain's DNS settings fix this:
- **SPF**: a list of services allowed to send email for our domain.
- **DKIM**: a digital signature on each email proving it was not altered.
- **DMARC**: tells mail services what to do with emails that fail the two checks (and sends us reports).

## Before you start
1. Decide the sending address, on **our own domain**, for example `no-reply@sparkmind.online`. (An email sent as `someone@gmail.com` through our system cannot be authenticated, because we do not own gmail.com.)
2. Know where the domain's DNS is edited. For a domain bought through Hostinger this is hPanel > Domains > the domain > **DNS / Nameservers** (DNS zone editor). If the domain points elsewhere (Cloudflare, GoDaddy...), edit it there.
3. Have the SendGrid login (the account used for AIN-367).

## Steps (SendGrid)
1. SendGrid > **Settings > Sender Authentication > Authenticate Your Domain**.
2. Choose the DNS host (or "Other"), enter the domain, leave "Use automated security" ON, and finish the wizard. SendGrid now shows **three CNAME records** (about `em1234.<domain>`, `s1._domainkey.<domain>`, `s2._domainkey.<domain>`). These are the SPF and DKIM records. The exact values are shown only on that screen: copy them exactly.
3. In the DNS zone editor, add each as type **CNAME**. Two common slips:
   - Some editors add the domain name for you. In that case enter only the first part (`s1._domainkey`), not `s1._domainkey.sparkmind.online`.
   - Turn off any "proxy" / orange-cloud option (Cloudflare) for these records.
4. Back in SendGrid press **Verify**. If it says "not yet", wait 15 minutes and try again (up to 24 hours in rare cases).
5. Add **DMARC** as a **TXT** record: host `_dmarc`, value
   `v=DMARC1; p=none; rua=mailto:<an address someone reads>`.
   `p=none` means "only watch and report, do not reject yet". Later, once reports look clean for a few weeks, it can be tightened to `p=quarantine`.
6. In the server `.env` set `SENDGRID_FROM_EMAIL=no-reply@<our domain>` (the address chosen above), leave `GMAIL_USER` unset (Gmail is tried first if it is set), then `pm2 reload ecosystem.config.cjs --update-env`.
7. **Only one SPF record may exist per domain.** If the domain already has a TXT record starting with `v=spf1`, do not add a second one: ask before changing it. SendGrid's CNAME method does not need one.

## Check that it worked
1. In the dashboard invite a team member whose address is a **Gmail** account (Team page > Invite someone).
2. In Gmail open the email > three dots > **Show original**. Near the top you must see: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
3. The email must be in the Inbox, not Spam. Also try an Outlook or Yahoo address if you have one.
4. Optional second opinion: send an email to the address shown on https://www.mail-tester.com and read its score (aim for 9 or 10 out of 10).
5. From the command line, the records can be seen with `nslookup -type=CNAME s1._domainkey.<domain>` and `nslookup -type=TXT _dmarc.<domain>`.

## If emails still go to spam
- Press **Verify** again in SendGrid and confirm the three records show as verified.
- Make sure the From address uses the authenticated domain, not Gmail.
- A brand-new sending domain has no reputation yet; a few days of normal sending improves this.
- `SENDGRID_FROM_EMAIL` must exactly match an authenticated domain or verified sender.

## When done
Tell the board: Jira **AIN-370** > Done, with a note of the Gmail "Show original" result.
