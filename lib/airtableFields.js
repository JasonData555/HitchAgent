/**
 * Single source of truth for all Airtable table and field name references used
 * by the Client Portal (subsystem 2). No portal route file may hardcode an
 * Airtable table or field string — every reference imports from here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFICATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Every name below was verified via the Airtable MCP `describe_table` against
 * base app8IuY5nHuUvrri4. A field-name mismatch is a SILENT failure — Airtable
 * treats unknown field names in formulas and writes as blank, never erroring —
 * so the literal strings must match the base exactly (including casing, spaces,
 * and punctuation such as the trailing "?" in ProjStat's "Display ?").
 *
 * A handful of constants are marked `NOT YET IN BASE` — they are referenced by
 * the portal spec but were not created during Prompt 0. They are included as
 * forward-looking constants; the field must be created in Airtable before the
 * route that reads/writes it goes live.
 */

// ── Tables ──────────────────────────────────────────────────────────────────
export const TABLES = {
  SEARCHES:           'Searches',           // one record per engagement
  RUBRIC:             'Rubric',             // one record per search (JD/MI output)
  PROJECTS:           'ProjStat',           // junction; "Project Name" links to Searches
  INTERVIEW_SCHEDULE: 'Interview Schedule', // one record per scheduled meeting
  PORTAL_SESSIONS:    'Portal Sessions',    // one record per authenticated reviewer
  ORGANIZATIONS:      'Organizations',      // target companies
  ITI_INPUT:          'ITI Input',          // panel members per search
  PEOPLE:             'People',             // person records (security leaders, candidates)
};

// ── People ──────────────────────────────────────────────────────────────────
export const PEOPLE_FIELDS = {
  FULL_NAME: 'FullName', // primary name field — used to resolve linked-record ids to names
};

// ── Searches ────────────────────────────────────────────────────────────────
export const SEARCHES_FIELDS = {
  NAME:                'Client&Search',       // primary field, e.g. "Coursera - CIO / CISO"
  PORTAL_SLUG:         'portal_slug',         // url
  PORTAL_STATUS:       'portal_status',       // singleSelect
  CLIENT_NAME:         'client_name',         // formula
  CLIENT_LOGO:         'client_logo',         // attachment — derive URL via getAttachmentUrl()
  DOMAIN:              'domain',              // lookup
  LINKEDIN_COMPANY_ID: 'linkedin_company_id', // number
  DISPLAY:             'Display',             // checkbox
  RUBRIC_LINK:         'Rubric',              // link → Rubric
  ORGANIZATIONS_LINK:  'Organizations 2',     // link → Organizations (target companies)
  PORTAL_FINALIZED:    'portal_finalized',    // checkbox — idempotency gate for generate-portal
  GENERATION_ERROR:    'generation_error',    // multilineText — generate-portal failure detail
};

// ── Rubric ──────────────────────────────────────────────────────────────────
export const RUBRIC_FIELDS = {
  SEARCH:                     'Search',          // formula (was guessed search_project_name)
  CLIENT_NAME:                'client_name',     // formula
  CLIENT_LOGO:                'client_logo',     // attachment
  RUBRIC_MATRIX_JSON:         'Rubric Matrix JSON',
  // Claude MI/JD output (created in Prompt 0):
  MARKET_INTELLIGENCE:        'market_intelligence_narrative',
  JOB_DESCRIPTION:            'job_description_narrative',
  MANDATE_BULLETS:            'mandate_bullets',
  SUCCESS_MILESTONES:         'success_milestones',
  // Existing rubric content fields (shared with subsystem 1):
  MUST_HAVE:                  'Must Have',
  NICE_TO_HAVE:               'Nice to Have',
  RED_FLAGS:                  'Red Flags',
  SUCCESS_IN_ROLE:            'Success in the Role',
  FUNCTIONAL_RESPONSIBILITIES:'Functional Responsibilities',
  REPORTING_STRUCTURE:        'reporting_structure', // multilineText — JD reporting_structure
  DRAFT_STATUS:               'Rubric Draft Status', // singleSelect; 'Shared with Client' = final
  // Context fields used when assembling the final rubric_content for JD generation:
  LOCATION:                   'Location',
  TEAM_SIZE_TODAY:            'Team Size Today',
  TEAM_SIZE_18_24:            'Est Team Size 18 - 24 mo',
};

// ── ProjStat (the "Projects" junction table) ────────────────────────────────
export const PROJECTS_FIELDS = {
  DISPLAY:      'Display ?',     // checkbox — note trailing space + "?". Pipeline gate.
  PROJECT_NAME: 'Project Name',  // link → Searches
  CANDIDATE:    'Candidate',     // link → People
  NAME:         'Name',          // formula — candidate name
  TITLE:        'Title',         // lookup — candidate title
  COMPANY:      'Company',       // lookup — candidate current company (name array)
  TILE_LINK:    'Tile PDF',      // link → Candidate Tile (tile_url id source)
  STAGE:        'Stage',         // singleSelect
  SHARED_NOTES: 'Shared Notes',  // richText
  FEEDBACK_UNLOCKED: 'feedback_unlocked', // checkbox — panel-summary reveal gate
};

// ── Interview Schedule ──────────────────────────────────────────────────────
export const SCHEDULE_FIELDS = {
  PROJECT:           'Project',              // link → Searches
  CANDIDATE_PROJECT: 'Candidate-Project',    // link → ProjStat
  INTERVIEWER:       'Interviewer',          // link → ITI Input
  INTERVIEWER_NAME:  'Interviewer Name',     // lookup
  INTERVIEWER_TITLE: 'Interviewer Title',    // lookup
  DATE:              'Interview Date',        // date  (was guessed "Date")
  TIME:              'Interview Time',        // text  (was guessed "Time")
  STATUS:            'Interview Status',      // singleSelect
  ORDER:             'Interview Order',       // lookup
  VERDICT:           'Interviewer Feedback',  // singleSelect Yes/Soft Yes/Soft No/No (reused)
  NOTES:             'Feedback Details',      // richText (reused)
  SESSION_TOKEN:     'portal_session_token',  // singleLineText
};

// ── Portal Sessions ─────────────────────────────────────────────────────────
// Identity is carried by a single link: NAME_LINK ('name') → ITI Input panel
// member. INTERVIEWER_TITLE and INTERVIEWER_COMPANY are read-only lookups that
// auto-populate from that link — the callback writes only NAME_LINK (plus the
// session essentials), never the lookups. FULL_NAME is a formula off the link.
export const SESSION_FIELDS = {
  SESSION_ID:          'session_id',                   // singleLineText (was guessed session_cookie_id)
  EMAIL:               'email',                        // email
  PORTAL_SLUG:         'portal_slug',                  // singleLineText
  DEACTIVATED:         'deactivate_portal_link',       // checkbox
  SCHEDULE_RECORD_ID:  'interview_schedule_record_id', // singleLineText
  NAME_LINK:           'name',                          // link → ITI Input (the only written identity field)
  FULL_NAME:           'Full Name',                     // formula (read-only)
  INTERVIEWER_TITLE:   'Interviewer Title',             // lookup → ITI Input panel_member_title (read-only)
  INTERVIEWER_COMPANY: 'Interviewer Company',           // lookup → ITI Input panel_member_company (read-only)
};

// ── ITI Input (panel members per search) ────────────────────────────────────
// Portal Sessions.name links here. Primary key KEY = "Name - Client - Position".
export const ITI_FIELDS = {
  KEY:                  'Interviewer_SearchProject', // formula primary key
  PANEL_MEMBER:         'panel_member',              // formula — interviewer name text
  PANEL_MEMBER_EMAIL:   'panel_member_email',        // lookup — email
  PANEL_MEMBER_TITLE:   'panel_member_title',        // lookup
  PANEL_MEMBER_COMPANY: 'panel_member_company',      // formula — client company
  SEARCH_PROJECT_LINK:  'Search Project',            // link → Searches
  SEARCH_PROJECT_TEXT:  'search_project',            // formula — Searches primary field text
  INTERVIEW_SCHEDULE:   'Interview Schedule',         // link → Interview Schedule
};

// ── Organizations (target companies) ────────────────────────────────────────
export const ORGANIZATIONS_FIELDS = {
  NAME:                      'name',               // singleLineText
  COMPANY_NAME:              'Company Name',       // formula
  DESCRIPTION:               'shortDescription',   // multilineText (was guessed "Description")
  CITY:                      'city',               // singleLineText (was guessed "City")
  STATE:                     'state',              // singleLineText
  COUNTRY:                   'country',            // singleLineText
  EMPLOYEE_COUNT:            'employeeCount',      // singleSelect
  INDUSTRY:                  'Industry',           // multipleSelects
  DOMAIN:                    'domain',             // url
  LINKEDIN_URL:              'linkedinUrl-company',// url
  FUNDING_TOTAL:             'fundingTotalUsd',    // currency
  CURRENT_SECURITY_LEADERS:  'Current Sec Leaders',// multipleRecordLinks → People (ids; names resolved in code)
  PREVIOUS_SECURITY_LEADERS: 'Prev Sec Leaders',  // multipleRecordLinks → People (ids; names resolved in code)
  TOP_SECURITY_DISPLAY:      'Top Security Display', // checkbox — gates Target Companies subset
  SEARCH_LINK:               'For Search Project', // link → Searches (Organizations 2 inverse)
};
