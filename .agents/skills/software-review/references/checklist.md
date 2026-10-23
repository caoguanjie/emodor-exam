# 英文原始清单

以下英文按用户原文保留。适用性、证据与输出规则见 [SKILL.md](../SKILL.md)。

> a schema someone designed, instead of one the AI improvised table by table
> login that still works when someone puts a plus sign in their email
> password reset links that expire and work once
> MFA, plus a recovery path for the user who lost their phone
> sessions that time out, and a way to kill every session for one user
> SSO for the enterprise customer who won't sign without it
> SAML, because that customer's IT team doesn't do magic links
> SCIM, so a fired employee loses access the moment IT offboards them
> roles and permissions deeper than "admin" and "everyone else"
> checks that stop user A from reading user B's data by changing one number in the URL
> tenant isolation, so one customer's bug never shows another customer's records
> an admin "log in as this user" button for support, with an audit trail on every use
> rate limits on login, so nobody can guess passwords at scale
> lockouts that stop attackers without locking out your CFO the night before the board meeting
> database migrations that run forward and roll back
> migrations that don't lock the main table at 2pm on a Tuesday
> indexes, because the query that was instant on 50 test rows times out on 5 million real ones
> connection pooling, so a traffic spike doesn't exhaust the database
> backups every night
> a restore from those backups, tested, because a backup you've never restored is a hope
> point-in-time recovery for the day someone runs a delete without a where clause
> soft deletes, so "I deleted it by accident" is a support ticket and not an incident
> validation on the server, not just in the form
> timezones stored right, so the 9am reminder doesn't fire at 4am
> the customer with an apostrophe in their last name
> emoji, accents and right-to-left text in every field
> money stored as integers, because 0.1 + 0.2 doesn't equal 0.3 in floating point
> currency, rounding and tax rules for every country you sell into
> a data model that survives your second customer asking for "one small change"
> idempotency keys, so a retried payment doesn't charge the card twice
> deduplication for the user who clicks submit four times
> pagination that still works on page 400
> exports, because sooner or later every customer wants their data in a spreadsheet
> imports that survive the CSV someone saved in 2009
> retention rules, and code that deletes what your contract says you'll delete
> secrets out of the code, out of the repo and out of the AI chat history
> rotating every key the AI pasted into a config file last month
> confirming every package the AI installed exists and is the one you meant
> dependency scanning, because the AI pulled in libraries nobody reviewed
> input sanitization everywhere a user can type
> protection against SQL injection, XSS, CSRF and the rest of the OWASP list
> file uploads that get scanned, size-limited and stored where they can't execute
> CORS rules that aren't "allow everything"
> security headers on every response
> encryption at rest and in transit
> least-privilege access for everyone, including the AI agent holding production credentials
> logs that record who did what, without recording passwords, tokens or card numbers
> a penetration test before your enterprise customer's security team runs their own
> answers to the security questionnaire every enterprise buyer sends, with evidence behind each one
> a disclosure process for the day a stranger emails you a vulnerability
> a plan for the day a laptop with production access gets stolen
> SOC 2, which means policies, evidence and an auditor, not a checkbox
> HIPAA, the moment a single patient record touches your system
> a BAA with every vendor that touches that data, including your AI model provider
> audit trails that show who viewed a record, not just who changed it
> PCI scope, and card numbers kept out of your database
> GDPR deletion requests that reach every table, backup and log
> data residency for the customer whose contract says EU only
> quarterly access reviews someone signs off on
> dev, staging and production environments that match each other
> infrastructure written as code, so the setup lives somewhere other than one person's memory
> a deploy pipeline that runs the tests before anything reaches customers
> one-click rollbacks, because Friday deploys happen
> zero-downtime deploys, because your customers don't have maintenance windows
> feature flags, so you can ship the code without shipping the feature
> autoscaling for the Monday morning spike
> a CDN, so the app loads fast in Singapore too
> DNS, SSL certificates, and renewals that don't expire on a Sunday
> background job queues, so slow work doesn't freeze the page
> retries with backoff, so one flaky API call doesn't become a lost order
> a dead-letter queue for the jobs that fail every retry
> cron jobs that don't run twice the day you add a second server
> caching, and clearing that cache when the data changes
> SPF, DKIM and DMARC, so your password resets don't land in spam
> bounce and complaint handling on every transactional email
> storage rules, so you stop paying to keep 2021's temp files
> cost alerts, so a runaway agent loop shows up the same day and not on the invoice (we learned this one for $1,382.59)
> a disaster recovery plan, written down and tested once a year
> a second region, if your contract promises uptime one region can't deliver
> structured logs you can search at 3am
> error tracking that groups the same bug instead of sending you 4,000 emails
> uptime checks from outside your own network
> alerts that page a human, tuned until they stop paging for nothing
> dashboards for latency, error rate and throughput
> tracing for one slow request across every service it touches
> an on-call rotation, and a person who picks up
> runbooks, so the engineer on call knows what "queue depth critical" means
> postmortems that change something
> a status page customers check before they email you
> unit tests written by someone who knows what the logic should do
> integration tests for every third-party API you depend on
> end-to-end tests for signup, checkout and the other flows that make you money
> load testing before the launch email goes out
> test data that looks like production without being production data
> regression tests, so fixing bug 41 doesn't bring back bug 12
> testing on the five-year-old laptop your biggest customer's ops team still uses
> accessibility compliance, because the enterprise contract requires it
> subscriptions, upgrades, downgrades and proration
> failed-payment retries and dunning emails
> invoices with the customer's PO number on them, because procurement won't pay without it
> sales tax and VAT
> refunds, credits and partial refunds
> usage metering that matches what you bill, to the cent
> annual contracts with custom terms your billing logic never planned for
> revenue reports your finance team can reconcile
> webhooks that verify signatures
> webhooks that retry, with a log of every failed delivery
> a versioned API, so you can change it without breaking your customers' integrations
> API keys customers can create and revoke
> API rate limits that protect you without blocking real integrations
> a plan for the day a third-party API changes its response format without telling you
> OAuth token refresh, because tokens expire at the worst possible moment
> a sandbox where customers can test their integration
> protection against prompt injection in every field that reaches the model
> customer and patient data kept out of prompts that leave your network
> a model spend cap per customer, so one heavy user can't run up your bill
> evals, so you find out when a model update makes your answers worse
> a fallback for the afternoon your model provider goes down
> a migration plan for the day your model gets deprecated
> prompt and output logs for debugging, minus whatever you're not allowed to keep
> a human approval step for anything the AI does that can't be undone
> pages that load on hotel wifi
> empty states, loading states and error states on every screen
> error messages a customer can act on, instead of "something went wrong"
> forms that keep what people typed when one field fails validation
> emails that render in every mail client your customers use
> notifications people can turn off
> undo
> keyboard navigation and screen reader support
> translations, with dates and numbers formatted for each locale
> a back button that does what people expect
> code a human can read
> code review on every change
> a branching strategy, so two people can work without overwriting each other
> monthly dependency upgrades, so you're never two major versions behind
> framework upgrades before the old version stops getting security patches
> deleting the dead code the AI left behind from its first three attempts
> splitting up the 2,000-line file the AI kept appending to
> architecture decisions written down, with the reasons
> a README that gets a new engineer running locally in under an hour
> documentation for whoever inherits this
> an admin panel for your ops team
> support tooling, so customer success can answer questions without pinging engineering
> a changelog customers can read
> terms and a privacy policy that match what the code does
> every account, domain and repo in the company's name, not the name of whoever built the prototype
> a bus factor higher than one

Oh, and besides keeping all of this working every day, forever… your vibe-coded app will still need people who know what they're doing:

> reading every line the AI wrote before it ships (a senior engineer)
> designing the data model before your second customer breaks it (a backend engineer)
> explaining why the AI's fix for one bug created two new ones (a senior engineer, again)
> deploys, rollbacks, servers and the cloud bill (a DevOps engineer)
> answering the page at 3am when payments stop (whoever's on call)
> patching the framework the week a vulnerability goes public (security)
> walking an auditor through how patient data moves (security and compliance)
> testing what the AI says it tested (QA)
> running a migration on a live database without losing a row (a backend engineer)
> saying no to the feature that breaks three others (a tech lead)
> turning "works on my laptop" into "works for every customer at once" (an architect)
> debugging the code when the AI that wrote it can't (a senior engineer)
> remembering why it's built this way, a year from now (someone who was there)
