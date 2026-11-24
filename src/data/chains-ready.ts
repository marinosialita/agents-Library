// The ready-made chains (10 Nov 2026: fifty, his request). Each is one job that really takes several agents, in the
// order a professional does it: a name «A → B → C», two short sentences for the card, and per step the agent and what
// it is asked to do with the task, the documents and the step before. Checked by scripts/check-chains.mjs.
export type ReadyChainSpec = { id: string; name: string; description: string; steps: [agentId: string, ask: string][] };

export const READY_CHAIN_SPECS: ReadyChainSpec[] = [
  { id: 'lease-letter-greek', name: 'Lease → letter to the tenant → Greek', description: 'Report on a lease from the tenant\'s side. Turn it into a polite letter, then into Greek.', steps: [
    ['ready-lease-report', 'Report on the attached lease: the points that matter for the tenant.'],
    ['ready-realestate-occupier-communication', 'From the lease report, write the letter to the tenant that raises those points, clearly and politely.'],
    ['ready-languages-business-document-translation', 'Translate the letter into Greek, keeping its tone and layout.']] },
  { id: 'month-end-board', name: 'Month-end commentary → one-slide summary', description: 'Explain every material variance in the accounts. Finish with one slide the board can read in a minute.', steps: [
    ['ready-finance-month-end-commentary', 'Write the month-end variance commentary from the attached accounts.'],
    ['ready-communication-one-slide-summary', 'Turn the commentary into a one-slide executive summary for the board.']] },
  { id: 'hiring', name: 'Role brief → job description → interview guide', description: 'Write the job description from a short brief. Build the structured interview that tests it.', steps: [
    ['ready-hr-job-description', 'Write the job description from the role brief.'],
    ['ready-hr-interview-guide', 'Build the structured interview guide for this job description.']] },
  { id: 'angry-customer', name: 'Angry customer → reply → reusable macro', description: 'Answer a difficult customer calmly. Keep the reply as a macro for the next case.', steps: [
    ['ready-support-angry-customer-reply', 'Write the reply to this customer.'],
    ['ready-support-macro-set', 'Turn this reply into a reusable macro for the same kind of complaint.']] },
  { id: 'meeting', name: 'Meeting notes → minutes → recap e-mail', description: 'Turn rough notes or a transcript into minutes. Send the recap with actions and owners.', steps: [
    ['ready-communication-meeting-minutes', 'Write the minutes from the attached notes or transcript.'],
    ['ready-communication-meeting-recap', 'From the minutes, write the recap e-mail to the attendees with the actions and owners.']] },
  // Legal
  { id: 'chronology-evidence-letter', name: 'Chronology → evidence matrix → letter before action', description: 'Build the chronology of a dispute and test the evidence on each issue. Finish with the letter before action.', steps: [
    ['ready-case-chronology', 'Build the chronology from the attached case documents, with the disputed facts and the critical deadlines.'],
    ['ready-evidence-matrix', 'From the chronology and the case documents, set out each issue in dispute: who bears the burden, the evidence for and against, and what is missing.'],
    ['ready-letter-before-action', 'Using the evidence matrix and the case documents, draft the letter before action with the facts, the legal basis and the demand.']] },
  { id: 'due-diligence-warranties', name: 'Data room → red flags → warranty gaps → client briefing', description: 'Find the red flags in a data room and test the warranties against them. Brief the client on one page.', steps: [
    ['ready-dd-red-flags', 'Read the attached data room documents and write the red flag report.'],
    ['ready-warranty-gap', 'Treat the red flag report as the due diligence and mark each warranty in the attached agreement as supported, partly supported or contradicted, naming the red flag behind each.'],
    ['ready-communication-one-page-briefing', 'Turn the warranty gap table into a one-page briefing for the client: what the due diligence found, what it means for the deal and what to do before signing.']] },
  { id: 'privacy-notice', name: 'Processing activities → records → privacy notice', description: 'Build the Article 30 records from what the company does with personal data. Draft the privacy notice in plain words.', steps: [
    ['ready-ropa-builder', 'Build the Article 30 records of processing from the attached description of what the company does with personal data.'],
    ['ready-privacy-policy', 'From the records of processing, draft the privacy notice under Articles 13 and 14 of the GDPR.'],
    ['ready-languages-plain-language-rewrite', 'Rewrite the privacy notice in plain language for the general reader, losing nothing that the notice must say.']] },
  // Finance & accounting
  { id: 'capex-business-case', name: 'Capex appraisal → business case → committee Q&A', description: 'Appraise a capital project and write its business case. Prepare the answers to the committee\'s hard questions.', steps: [
    ['ready-finance-capex-appraisal', 'Appraise the capital project from the attached figures: NPV at the hurdle rate, IRR, discounted payback and the sensitivities.'],
    ['ready-finance-business-case', 'From the appraisal, write the business case for the investment committee: the options, the financial case, the risks and the recommendation.'],
    ['ready-communication-audience-qa-prep', 'From the business case, prepare the questions the committee is likely to ask, the hard ones included, with a short answer to each.']] },
  // People & HR
  { id: 'engagement-survey-actions', name: 'Engagement survey → action plan → all-hands talking points', description: 'Find what the engagement survey really says and turn it into actions. Prepare the leader to present both.', steps: [
    ['ready-hr-engagement-survey-analysis', 'Analyse the attached engagement survey results: scores, the drivers behind them, themes from the comments and three priorities.'],
    ['ready-hr-engagement-action-plan', 'Turn the three priorities of the analysis into an action plan, with an owner, a date and a measure for each action.'],
    ['ready-communication-all-hands-talking-points', 'From the action plan and the survey results, prepare the talking points for the all-hands where the leader presents what was said and what will change.']] },
  // Marketing & sales
  { id: 'positioning-landing-page', name: 'Positioning → messaging framework → landing page copy', description: 'Work out the positioning from product notes and customer evidence. Turn it into messaging and a landing page.', steps: [
    ['ready-marketing-positioning-canvas', 'Build the positioning canvas from the attached product notes and customer evidence.'],
    ['ready-marketing-messaging-framework', 'Turn the positioning canvas into a messaging framework: one value proposition, three pillars with proof points and the message by persona.'],
    ['ready-marketing-landing-page-copy', 'From the messaging framework, write the full copy of the landing page for the best-fit customer.']] },
  { id: 'keyword-article-social', name: 'Keyword → content brief → article → social posts', description: 'Write the content brief for a keyword and the article from it. Repurpose the article into social posts.', steps: [
    ['ready-marketing-keyword-content-brief', 'Write the SEO content brief for the target keyword named in the task.'],
    ['ready-marketing-article-draft', 'Write the long-form article from the content brief, following its outline and answering its questions.'],
    ['ready-marketing-social-post-set', 'Repurpose the article into a set of social posts for each platform, true to what the article says.']] },
  // Operations
  { id: 'process-map-waste-sop', name: 'Process notes → process map → waste analysis → new SOP', description: 'Map a process as it runs today and find the waste in it. Write the improved procedure as an SOP.', steps: [
    ['ready-operations-process-map', 'Map the process described in the attached notes as a SIPOC table and a swimlane flow, marking every hand-off, wait and rework loop.'],
    ['ready-operations-lean-waste-analysis', 'Review the mapped process for the eight lean wastes, rank them by cost and propose a countermeasure for each.'],
    ['ready-operations-sop-from-walkthrough', 'Write the standard operating procedure for the process with the proposed countermeasures built in: numbered steps, owners, checks and exceptions.']] },
  { id: 'supplier-bids-award', name: 'Supplier bids → scoring → award memo → negotiation brief', description: 'Score the supplier bids and write the award recommendation. Prepare the negotiation with the preferred supplier.', steps: [
    ['ready-operations-weighted-bid-scoring', 'Score the attached supplier proposals against the RFP criteria, with total cost of ownership and a sensitivity check on the weights.'],
    ['ready-communication-decision-memo', 'From the scoring, write the award memo for approval: the recommended supplier up front, the other bids as options, the costs and the risks.'],
    ['ready-operations-negotiation-brief', 'Prepare the negotiation with the supplier the memo recommends, using the other bids as leverage: targets, walk-away points and the first three moves.']] },
  // Product & engineering
  { id: 'prd-stories-test-plan', name: 'Feature idea → PRD → user stories → test plan', description: 'Write the requirements for a feature and break them into user stories. Plan how the feature will be tested.', steps: [
    ['ready-product-prd', 'Write the product requirements document for the feature idea in the task, using the attached notes.'],
    ['ready-product-user-stories', 'Turn the PRD into user stories, each with Given / When / Then acceptance criteria for the happy path, the edge cases and the failures.'],
    ['ready-product-test-plan', 'From the user stories and their acceptance criteria, write the test plan: cases by level, the edge-case matrix and the exit criteria.']] },
  { id: 'feedback-rice-roadmap', name: 'Customer feedback → themes → RICE ranking → roadmap', description: 'Sort raw customer feedback into themes and rank them with RICE. Write the quarter\'s roadmap from the ranking.', steps: [
    ['ready-product-feedback-themes', 'Sort the attached customer feedback into themes with counts, severity, example quotes and the segments affected.'],
    ['ready-product-rice-prioritisation', 'Treat each theme as a candidate initiative and rank them with RICE, showing every input and where it comes from.'],
    ['ready-product-roadmap', 'From the RICE ranking, write the outcome-based roadmap for the next quarter, with what is explicitly not planned.']] },
  // Healthcare
  { id: 'incident-root-cause-qi', name: 'Incident account → report → root cause → QI charter', description: 'Write up a patient-safety incident and analyse its root causes. Start the improvement project that follows.', steps: [
    ['ready-healthcare-incident-report', 'Turn the attached staff account into the incident report: a timed factual chronology, the immediate actions and the evidence to preserve.'],
    ['ready-healthcare-root-cause-analysis', 'From the incident report, run the root cause analysis: care and service delivery problems, contributory factors, root causes and actions.'],
    ['ready-healthcare-qi-charter', 'Take the main root cause of the analysis as the problem statement and build the one-page quality improvement charter: aim, measures and first PDSA cycles.']] },
  { id: 'discharge-leaflet-teach-back', name: 'Discharge summary → patient leaflet → teach-back script', description: 'Write the discharge summary from the inpatient record. Explain it to the patient in a leaflet and a teach-back script.', steps: [
    ['ready-healthcare-discharge-summary', 'Write the discharge summary from the attached inpatient record, flagging every gap.'],
    ['ready-healthcare-patient-leaflet', 'Rewrite what the patient needs from the discharge summary as a plain-language leaflet: what happened, what to do and when to seek help.'],
    ['ready-healthcare-teach-back-script', 'Turn the instructions in the leaflet into a teach-back script for the discharge conversation, with a check question for each point.']] },
  // Education
  { id: 'lesson-slides-quiz', name: 'Topic → lesson plan → slide outline → retrieval quiz', description: 'Plan one lesson from a topic and a class. Outline its slides and write the retrieval quiz that follows it.', steps: [
    ['ready-education-lesson-plan', 'Plan one lesson on the topic and for the class named in the task, timed to the minute.'],
    ['ready-education-slide-outline', 'Outline the slides of the planned lesson one by one, each with speaker notes and timings.'],
    ['ready-education-retrieval-quiz', 'From the content the slides teach, write a low-stakes retrieval quiz with its answer key.']] },
  { id: 'training-needs-course', name: 'Training needs → course design → facilitator guide', description: 'Find the gaps that training can really close and design the course for them. Write the facilitator guide.', steps: [
    ['ready-education-training-needs', 'Analyse the attached performance data and role requirements, and say which gaps training can really close.'],
    ['ready-education-course-design', 'Design the training course for the gaps the analysis says training can close: objectives, modules, methods and assessment.'],
    ['ready-education-facilitator-guide', 'Write the facilitator guide for the first workshop of the course design: the run sheet, the scripts for each activity and the debrief prompts.']] },
  // Languages
  { id: 'transcript-subtitles-translation', name: 'Raw transcript → subtitles → translated subtitles', description: 'Clean a raw transcript and cut it into subtitles. Translate the subtitles within the same timings.', steps: [
    ['ready-languages-transcript-cleanup', 'Clean the attached transcript, keeping its timestamps and marking every unclear passage.'],
    ['ready-languages-subtitle-creation', 'Turn the cleaned transcript into subtitles that follow the professional norms, delivered as SRT.'],
    ['ready-languages-subtitle-translation', 'Translate the subtitle file cue by cue into the language named in the task, within the same timings.']] },
  // Creative
  { id: 'explainer-video-storyboard', name: 'Brief → explainer script → storyboard → image prompts', description: 'Write an explainer video script from a brief and break it into a storyboard. Write the image prompt for each frame.', steps: [
    ['ready-creative-explainer-script', 'Write the explainer video script from the attached brief, in two-column audio-visual format with timecodes.'],
    ['ready-creative-shot-list-storyboard', 'Break the script into a numbered shot list and storyboard frames, with a shooting order by setup.'],
    ['ready-creative-image-prompts', 'Write an image-generation prompt for each storyboard frame, all in one consistent style.']] },
  // Communication
  { id: 'change-announcement-faq', name: 'Change → communication plan → announcement → FAQ', description: 'Plan how a change is communicated to each audience. Write the staff announcement and the FAQ that goes with it.', steps: [
    ['ready-communication-change-comms-plan', 'Plan how the change described in the task is communicated: the audiences and their concerns, the key messages, the channels and the sequence.'],
    ['ready-communication-internal-announcement', 'From the plan\'s key messages, write the announcement to all staff: what is happening, why, what it means for them and what happens next.'],
    ['ready-communication-change-faq', 'Write the FAQ that goes out with the announcement: the questions people will really ask about this change and the honest answers.']] },
  // Compliance & risk
  { id: 'policy-gaps-attestation', name: 'Policy → gap analysis → redrafted policy → attestation', description: 'Check a policy against a standard and redraft it to close the gaps. Prepare the staff attestation campaign.', steps: [
    ['ready-compliance-policy-gap-analysis', 'Map the attached policy against the standard or regulation named in the task, clause by clause, and list the gaps with the fix for each.'],
    ['ready-compliance-policy-drafting', 'Redraft the policy so that it closes every gap in the analysis, in the structure regulators and auditors expect.'],
    ['ready-compliance-attestation-campaign', 'Prepare the attestation campaign for the redrafted policy: the attestation text, comprehension questions, schedule and reminders.']] },
  { id: 'audit-findings-risk-committee', name: 'Audit findings → risk register → risk committee report', description: 'Write the audit report from the workpapers and update the risk register. Report the result to the risk committee.', steps: [
    ['ready-compliance-audit-findings-report', 'Write the audit report from the attached workpapers and interview notes: each finding with its condition, criteria, cause, consequence and action.'],
    ['ready-compliance-risk-register', 'Update the risk register from the findings of the audit report: each risk with its cause, event, consequence, rating, controls, owner and actions.'],
    ['ready-compliance-risk-committee-report', 'From the updated risk register, write the report to the risk committee: the top risks and their movement, the overdue actions and the decisions asked.']] },
  // Business & strategy
  { id: 'strategy-plan-okrs', name: 'Strategy review → operating plan → quarterly OKRs', description: 'Review the strategy and turn it into next year\'s operating plan. Draft the first quarter\'s OKRs from the plan.', steps: [
    ['ready-business-strategy-review', 'Review the strategy from the attached plans, accounts and market notes, and state the choices made and the decisions to take.'],
    ['ready-business-annual-operating-plan', 'Turn the reviewed strategy into next year\'s operating plan: the five priorities, the targets and the initiatives with owners and milestones.'],
    ['ready-business-quarterly-okr-set', 'Draft the first quarter\'s objectives and key results from the operating plan, with baselines, targets and owners.']] },
  { id: 'decision-memo-pre-mortem', name: 'Options → decision matrix → six-page memo → pre-mortem', description: 'Compare the options for a decision and write the narrative memo. Stress the recommended plan with a pre-mortem.', steps: [
    ['ready-business-options-decision-matrix', 'Compare the options in the task with weighted criteria, score each from the evidence and test how sensitive the ranking is to the weights.'],
    ['ready-business-six-page-decision-memo', 'Write the six-page narrative memo for this decision from the options analysis: the situation, the options, the recommendation, the risks and the FAQ.'],
    ['ready-business-pre-mortem', 'Run a pre-mortem on the plan the memo recommends: assume it has failed, list the causes and say how the plan should change.']] },
  // Data & analytics
  { id: 'dataset-cleaning-dictionary', name: 'Dataset → profile → cleaning rules → data dictionary', description: 'Profile a dataset and specify the rules that clean it. Document the cleaned columns in a data dictionary.', steps: [
    ['ready-data-dataset-profile', 'Profile the attached dataset column by column and say what to clean first and in what order.'],
    ['ready-data-cleaning-rules', 'Turn the problems the profile found into a cleaning specification: one rule per issue with its condition, action and order.'],
    ['ready-data-dictionary', 'Write the data dictionary for the dataset as it will be once the cleaning rules are applied: each column\'s meaning, type, allowed values and caveats.']] },
  { id: 'metric-diagnosis-slide', name: 'Metric change → diagnosis → report → one slide', description: 'Find out why a metric moved and write the performance report around it. Compress the report into one slide.', steps: [
    ['ready-data-metric-change-diagnosis', 'Explain why the metric named in the task moved, from the attached data: check the definitions first, then decompose the change by segment and mix.'],
    ['ready-data-recurring-performance-report', 'Write the period\'s performance report around the diagnosis: what moved, by how much and why, as far as the data shows.'],
    ['ready-communication-one-slide-summary', 'Compress the performance report into one slide for the executives: the message, three proof points, the ask and the risk.']] },
  // Customer support
  { id: 'account-health-save-plan', name: 'Account data → health score → save plan → meeting brief', description: 'Score the health of an account and build the plan that saves it. Brief the executive who meets the customer.', steps: [
    ['ready-support-account-health-score', 'Score the health of the account from the attached usage, support and commercial data, with the reasons behind the score.'],
    ['ready-support-churn-save-plan', 'Build the save plan for this account from its red signals: their root cause, what the customer needs, the offer, the owners and the dates.'],
    ['ready-communication-pre-meeting-brief', 'From the save plan, prepare the one-page briefing for the executive who will meet the customer: their concerns, our position, the asks and the talking points.']] },
  // Real estate & construction
  { id: 'property-investment-summary', name: 'Comparables → valuation → appraisal → investment summary', description: 'Value a property from comparable evidence and appraise it as an investment. Summarise the case on one page.', steps: [
    ['ready-realestate-comparable-valuation', 'Produce an indicative market rent and value for the property from the attached comparable evidence, with the adjustment grid.'],
    ['ready-realestate-investment-dcf-appraisal', 'Appraise the property as an investment from that rent and value and the attached tenancy data: yields, a ten-year cash flow, NPV, IRR and sensitivities.'],
    ['ready-realestate-investment-summary', 'Write the one-page investment summary from the appraisal: the asset, the income, pricing and returns, the risks and the due diligence still needed.']] },
  // Science & research
  { id: 'results-abstract-cover-letter', name: 'Statistical output → results → abstract → cover letter', description: 'Read the statistical output and write what it means. Write the abstract and the cover letter to the editor.', steps: [
    ['ready-research-results-interpretation', 'Read the attached statistical output and write what it means: the estimates with their intervals, what is supported and the caveats.'],
    ['ready-research-structured-abstract', 'Write the structured abstract from the interpreted results and the attached notes, claiming no more than the data shows.'],
    ['ready-research-submission-cover-letter', 'From the abstract, write the cover letter to the editor of the journal named in the task: what the paper shows and why it fits the journal.']] },
  // Public sector & nonprofits
  { id: 'evidence-policy-briefing', name: 'Evidence review → policy brief → briefing note', description: 'Synthesise the evidence on a policy question and write the brief with options. Cut it to a note for the decision-maker.', steps: [
    ['ready-public-evidence-review', 'Synthesise the attached reports, studies and data into an evidence review: what is known, how strong it is and where the sources disagree.'],
    ['ready-public-policy-brief', 'From the evidence review, write the policy brief: the problem, three to four options appraised against stated criteria and a recommendation.'],
    ['ready-public-briefing-note', 'Turn the policy brief into a two-page briefing note for the decision-maker: issue, key points, lines to take, risks and the decision asked.']] },
  // Hospitality & tourism
  { id: 'event-order-run-sheet', name: 'Event → banquet event order → run sheet → staff briefing', description: 'Turn a confirmed event into the banquet event order and the run sheet. Brief the team before the shift.', steps: [
    ['ready-hospitality-banquet-event-order', 'Turn the attached confirmed event details into the banquet event order, with the open items flagged.'],
    ['ready-hospitality-event-run-sheet', 'Write the minute-by-minute run sheet for the event from the banquet event order: who does what, where and with what.'],
    ['ready-hospitality-pre-shift-briefing', 'From the run sheet, write the pre-shift briefing for the team working the event: timings, VIPs, menus and allergens, and the moments that usually slip.']] },
  // Shipping, logistics & trade
  { id: 'charter-party-voyage-instructions', name: 'Charter party → key terms → voyage instructions', description: 'Summarise a charter party into the terms the operator works with. Draft the voyage instructions to the master.', steps: [
    ['ready-shipping-charter-party-summary', 'Summarise the attached charter party with its rider clauses and addenda into the terms the operator works with.'],
    ['ready-shipping-voyage-instructions', 'Draft the voyage instructions to the master from the summary of terms: cargo, ports, notices, bills of lading, bunkers and reporting.']] },
  // Insurance & claims
  { id: 'underwriting-referral', name: 'Submission → risk summary → pricing note → referral', description: 'Summarise a submission as the underwriter reads it and price the risk. Write the referral to the senior underwriter.', steps: [
    ['ready-insurance-risk-summary', 'Turn the attached submission into the underwriter\'s risk summary: the risk, its exposures, the loss history and what is still missing.'],
    ['ready-insurance-technical-pricing-note', 'Write the technical pricing note for the risk as summarised, from the exposure and loss figures in the submission.'],
    ['ready-insurance-referral-note', 'From the pricing note and the submission, write the referral to the senior underwriter: the risk in ten lines, the terms proposed and the recommendation.']] },
  // IT & cybersecurity
  { id: 'security-incident-notice', name: 'Logs → incident timeline → report → customer notice', description: 'Build the timeline of a security incident from the logs and write the formal report. Tell the customers affected.', steps: [
    ['ready-it-security-incident-timeline', 'Build the evidence-based timeline of the incident from the attached logs, tickets and chat, each event in UTC with its source.'],
    ['ready-it-major-incident-report', 'Write the formal major incident report from the timeline: service impact, cause and contributing factors, the response and corrective actions.'],
    ['ready-communication-customer-notice', 'From the incident report, write the notice to the customers affected: what happened, who is affected, what we are doing and what they must do.']] },
  { id: 'impact-recovery-tabletop', name: 'Impact analysis → recovery plan → tabletop exercise', description: 'Work out what each system must recover and by when, then write the recovery plan. Test it with a tabletop exercise.', steps: [
    ['ready-it-business-impact-analysis', 'Run the business impact analysis from the attached list of processes and systems: the RTO and RPO each system inherits and the recovery tiers.'],
    ['ready-it-disaster-recovery-plan', 'Write the disaster recovery plan for the tier-one systems of the analysis: activation criteria, roles, ordered recovery steps and failback.'],
    ['ready-it-tabletop-exercise', 'Design a tabletop exercise that tests this recovery plan: a realistic scenario, timed injects and the decisions each should force.']] },
  // Banking & investment
  { id: 'credit-memo-committee', name: 'Borrower accounts → spread → credit memo → committee Q&A', description: 'Spread a borrower\'s accounts and write the credit memo for the facility. Prepare for the committee\'s questions.', steps: [
    ['ready-finserv-financial-spreading', 'Spread the attached financial statements of the borrower into the standard lending format, with the ratios and the adjustments made.'],
    ['ready-finserv-credit-application-memo', 'From the spread, write the credit memo for the facility requested in the task: the financial analysis, repayment sources, risks and recommendation.'],
    ['ready-communication-audience-qa-prep', 'From the credit memo, prepare the questions the credit committee is likely to ask, the hard ones included, with a short answer to each.']] },
  // Manufacturing & engineering
  { id: 'complaint-8d-fmea-control-plan', name: 'Customer complaint → 8D → process FMEA → control plan', description: 'Solve a customer complaint with an 8D report. Carry what it found into the process FMEA and the control plan.', steps: [
    ['ready-manufacturing-8d-report', 'Write the 8D report for the attached customer complaint, from D0 to D8.'],
    ['ready-manufacturing-process-fmea', 'Update the process FMEA with the failure modes and root causes the 8D found: effects, causes, controls, ratings and recommended actions.'],
    ['ready-manufacturing-control-plan', 'Write the control plan for the affected characteristics from the updated FMEA: specification, measurement method, sample, frequency and reaction plan.']] },
  { id: 'engineering-change-work-instruction', name: 'Change request → work instruction → operators\' language', description: 'Write up an engineering change and the work instruction that follows from it. Translate it for the operators.', steps: [
    ['ready-manufacturing-engineering-change-request', 'Write the engineering change request for the change described in the task: reason, before and after, impact, validation and implementation plan.'],
    ['ready-manufacturing-operator-work-instruction', 'From the change request, write the station work instruction for the process as it will run after the change: major steps, key points, quality checks and safety points.'],
    ['ready-languages-technical-translation', 'Translate the work instruction into the operators\' language named in the task, keeping every warning and unit exact.']] },
  // Sustainability & ESG
  { id: 'energy-audit-business-case', name: 'Energy bills → audit → business case → decision memo', description: 'Audit a site\'s energy use and build the investment case for the best saving measure. Ask management for the decision.', steps: [
    ['ready-sustainability-energy-audit-report', 'Write the energy audit of the site from the attached bills, meter data and equipment list, with a ranked list of saving measures.'],
    ['ready-sustainability-efficiency-business-case', 'Build the investment case for the top-ranked measure of the audit: baseline, saving, capex, payback, NPV and the carbon effect.'],
    ['ready-communication-decision-memo', 'Turn the investment case into a decision memo for management: the recommendation up front, the options, the costs and the decision requested.']] },
  // Startups & fundraising
  { id: 'pitch-deck-teardown-qa', name: 'Pitch deck → teardown → new storyline → investor Q&A', description: 'Read a pitch deck as an investor would and rebuild its storyline. Prepare the answers to the hard questions.', steps: [
    ['ready-startups-pitch-deck-teardown', 'Read the attached pitch deck the way a partner at a fund would: the verdict, each slide\'s claim against its proof and the fixes in order.'],
    ['ready-business-pitch-deck-narrative', 'Rebuild the storyline of the deck slide by slide so that it fixes what the teardown found, with the number each slide must carry.'],
    ['ready-startups-investor-qa-prep', 'From the new storyline, build the bank of hard questions an investor will ask about this company, with an answer-first reply to each.']] },
  { id: 'runway-bridge-memo', name: 'Runway check → extension plan → bridge round memo', description: 'Calculate the runway and build the plan that extends it. Write the memo asking the investors for a bridge.', steps: [
    ['ready-startups-runway-default-alive', 'Calculate net burn, runway and the zero-cash date from the attached bank and ledger figures, and test whether the company is default alive.'],
    ['ready-startups-runway-extension-plan', 'From that runway, build the plan that reaches the target in the task: every lever ranked by cash gained, speed and damage, in three packages.'],
    ['ready-startups-bridge-round-memo', 'From the runway plan, write the memo asking the existing investors for a bridge: the milestone it reaches, the amount and the plan without it.']] },
  // Project management
  { id: 'charter-scope-wbs', name: 'Mandate → charter → scope statement → WBS', description: 'Draft the project charter from the mandate and the scope statement from the charter. Break the scope into a WBS.', steps: [
    ['ready-projects-project-charter', 'Draft the project charter from the attached mandate, with the gaps the sponsor must close before signing.'],
    ['ready-projects-scope-statement', 'Write the scope statement from the charter: deliverables with acceptance criteria, exclusions, constraints and assumptions.'],
    ['ready-projects-work-breakdown-structure', 'Decompose the scope statement into a deliverable-based work breakdown structure, with a dictionary entry for every work package.']] },
  { id: 'rag-exception-escalation', name: 'RAG check → exception report → sponsor escalation', description: 'Test a project\'s status against the evidence and report what breaks tolerance. Escalate to the sponsor on one page.', steps: [
    ['ready-projects-rag-status-assessment', 'Test the project\'s reported status against the attached evidence and the agreed tolerances, dimension by dimension.'],
    ['ready-projects-exception-report', 'Write the exception report for every tolerance the assessment shows will be exceeded: cause, consequences, options and a recommendation.'],
    ['ready-projects-sponsor-escalation-brief', 'Turn the exception report into a one-page escalation to the sponsor in SBAR order, ending with the single decision asked for and its deadline.']] },
  // Retail & e-commerce
  { id: 'supplier-sheet-marketplace-listing', name: 'Supplier sheet → listing → marketplace → shot brief', description: 'Turn a supplier sheet into a listing that sells. Fit it to your marketplace and brief the photos.', steps: [
    ['ready-retail-listing-from-supplier-sheet', 'Write the product listing from the attached supplier sheet: a structured title, benefit-led bullets, the description and the attributes.'],
    ['ready-retail-marketplace-listing-optimisation', 'Rebuild this listing for the marketplace named in the task: the title, bullets and backend terms within that marketplace\'s limits.'],
    ['ready-retail-image-shot-brief', 'Write the shot list for the images this marketplace listing needs: hero, angles, details, scale and in-use, with styling notes.']] },
  { id: 'trading-week-promotion-briefing', name: 'Trading report → promotion plan → store briefing', description: 'Read the week\'s trading and plan the promotion it calls for. Brief the store teams for day one.', steps: [
    ['ready-retail-weekly-trading-report', 'Write the weekly trading report from the attached sales data: sales and margin against last week, last year and plan, with the drivers.'],
    ['ready-retail-promotion-plan', 'From the trading report, plan one promotion for the weakest category: the mechanic, the forecast uplift and the margin after funding.'],
    ['ready-retail-daily-store-briefing', 'Turn the promotion plan into the five-minute store team briefing for the first day of the promotion.']] },
  // Everyday life
  { id: 'job-application', name: 'Job advert → tailored CV → cover letter → interview prep', description: 'Tailor your CV to a job advert and write the cover letter. Prepare for the interview that follows.', steps: [
    ['ready-everyday-cv-rewrite', 'Rewrite the attached CV for the attached job advert: the profile, the achievements as results and the keywords the screening looks for.'],
    ['ready-everyday-cover-letter', 'Write the one-page cover letter for this job from the tailored CV and the advert.'],
    ['ready-everyday-interview-prep', 'Building on the evidence the cover letter puts forward, prepare me for the interview: the likely questions, strong STAR answers and questions to ask.']] },
  { id: 'trip-itinerary-packing', name: 'Trip → itinerary → packing list', description: 'Plan a trip day by day with its logistics. Build the packing list that fits the plan.', steps: [
    ['ready-everyday-trip-itinerary', 'Plan the trip in the task day by day: a realistic route, transport between stops, bookings to make and a budget.'],
    ['ready-everyday-packing-list', 'Build the packing list for this itinerary from its activities, the likely weather and the length of stay, grouped by bag.']] },
];
