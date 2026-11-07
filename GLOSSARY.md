# Reverse Recruiting Assistant

A personal agent for one Admin that finds new Jobs and, once approved, emails an Application directly to the people who can hire at the Company.

## Language

### Finding jobs

**Admin**:
The single person who owns the agent and approves every Application.
_Avoid_: User, candidate, applicant

**Job Board**:
A built-in, switchable source of Jobs with its own dedicated collector: LinkedIn Jobs or Glassdoor.
_Avoid_: Source, site

**Job Feed**:
A filtered job listing URL that the Admin copies from any website and gives to the agent.
_Avoid_: Search, Job Board, saved search

**Job**:
A unique open position found on a Job Board or Job Feed, displayed to the Admin once.
_Avoid_: Listing, posting, vacancy

**Duplicate Job**:
A Job with the same URL as another, or the same title, Company and post day.
_Avoid_: Repost

**Job Collection**:
The daily gathering of new Jobs from every enabled Job Board and Job Feed.
_Avoid_: Scrape, sync

**Excluded Keyword**:
A word or phrase set by the Admin. A Job whose title contains it as a whole word, ignoring case, is skipped by Job Collection and never saved.
_Avoid_: Blocklist, negative keyword

**Job Alert**:
The chat message telling the Admin about one new Job, linking to its original page. It carries no approval.
_Avoid_: Notification, Prepare prompt

**Failure Alert**:
The short chat message telling the Admin that a Function failed, linking to the dashboard. A Function killed by Modal can't send one.
_Avoid_: Notification, Job Alert

### Applying

**Company**:
The employer behind a Job, identified by its LinkedIn page.
_Avoid_: Employer, organization

**Resume**:
A PDF in the Admin's Resume Folder whose filename ends in "resume" or "CV" and names the role it targets, shared with recipients as a Drive link.
_Avoid_: CV document, profile

**Resume Folder**:
The one Google Drive folder the Admin chose to hold their Resumes.
_Avoid_: Library

**Job Summary**:
A one-paragraph summary of a Job's description, used to write the cover letter.
_Avoid_: Digest

**Person**:
Anyone found at a Company during the search for Decision Makers, with or without an email address.
_Avoid_: Contact, lead, employee

**Decision Maker**:
A person at a Company chosen to receive Applications, by job function priority. The search chooses at most 5 for an Application; the Admin can add more of the Company's people with emails in Review.
_Avoid_: Contact, lead, recruiter, reach-out person

**Application**:
The outreach for one Job: the chosen Resume, the cover letter and the Decision Makers, from preparation through sending.
_Avoid_: Outreach, campaign

**Prepare**:
The Admin's first approval, which starts building an Application without sending anything.
_Avoid_: Apply

**Review**:
The Admin's final check of a prepared Application, where they can edit it, ending in Send or Cancel.
_Avoid_: Confirmation

**Send**:
The Admin's second approval, which emails a reviewed Application to its Decision Makers.
_Avoid_: Submit

**Cancel**:
The Admin's final decision at Review not to send an Application. A cancelled Job cannot be Prepared again.
_Avoid_: Reject, delete

**Retry**:
The Admin's resumption of a Failed Application from the step it failed at, skipping finished steps and anyone already emailed.
_Avoid_: Rerun, restart

**Step Log**:
The record of one attempt at one step of an Application, with its result or error, shown on the dashboard.
_Avoid_: Event, history

**No Contacts**:
The outcome of an Application that ends with no Decision Maker who has an email address.
_Avoid_: Failed

**Direct Apply**:
The outcome of an Application stopped because the Company's LinkedIn page couldn't be confirmed, advising the Admin to apply through the Job link with the chosen Resume.
_Avoid_: Manual apply, Failed

**Email-Found Rate**:
Of the Applications that got past the search for Decision Makers, or ended in No Contacts or Direct Apply, the share that reached at least one Decision Maker with an email address.
_Avoid_: Hit rate, match rate

**Cover Letter**:
The job-specific email written once per Application, then personalized with each Decision Maker's name and the Resume link.
_Avoid_: Template, message

**Cooldown**:
The 30 days after a Decision Maker is emailed, during which they cannot be emailed again.
_Avoid_: Blocklist

**People Refresh**:
The search for a Company's Decision Makers again, required once its saved people are 6 months old.
_Avoid_: Re-scrape
