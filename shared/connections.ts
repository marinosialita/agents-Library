// «Connections» (10 Nov 2026, his «connect my gmail and set the agent to review and give me a brief every morning»).
// Ported from MyNomosAI's «Συνδέσεις» (shared/connections.ts there): each service is one button and one sign-in window
// run by Composio (https://docs.composio.dev), whose Google and Microsoft apps are already approved. Agents read a
// service only for a brief the owner runs, on the server, and never send, post or delete anything there.
//
// Until the app has accounts, connections belong to ONE owner: the server holds CONNECTIONS_OWNER_CODE and the browser
// must show it (the owner types it once on this device). A visitor without the code can try the demo inbox only.

export const CONNECTOR_IDS = ['gmail', 'googlecalendar', 'outlook',
  // 11 Nov 2026 (his request «telegram whatsapp microsoft teams github etc … need to support all»): every app whose
  // read-only tools are confirmed on docs.composio.dev/toolkits/<slug>.md (read 11 Nov 2026).
  'googledrive', 'microsoftteams', 'onedrive', 'slack', 'zoom', 'notion', 'dropbox', 'github', 'jira', 'trello', 'hubspot',
  // 11 Nov 2026, his «add 2 more here … so can be symmetric»: six in each of the last two groups.
  'box', 'calendly', 'gitlab', 'confluence',
  // His «Yes, add Figma» (11 Nov 2026), with Linear and Asana so every row of three is full.
  'figma', 'linear', 'asana',
  // 13 Nov 2026 (the n8n / Make study: Sheets is the app their AI templates use most): three more Google apps, so the
  // group is six, and a «Sales & social» row of three. Tools read on docs.composio.dev/toolkits/<slug>.md, 13 Nov 2026.
  'googlesheets', 'googledocs', 'googlemeet', 'linkedin', 'salesforce', 'airtable'] as const;
export type ConnectorId = typeof CONNECTOR_IDS[number];
export type ConnectorFamily = 'google' | 'microsoft' | 'team' | 'work' | 'sales';
/** mail and calendar have their own tools; «updates» is the shared read-only list (messages, mentions, changes, tasks). */
export type ConnectorReads = 'mail' | 'calendar' | 'updates';

export type Connector = {
  id: ConnectorId;
  /** Composio toolkit slug (https://docs.composio.dev/toolkits). */
  toolkit: string;
  name: string;
  family: ConnectorFamily;
  reads: readonly ConnectorReads[];
  /** What the agents do with it, in one line the owner can trust. */
  uses: string;
  /** Figma: the team link the owner pastes once, as Composio cannot find the team from the sign-in. */
  needsTeam?: boolean;
};

export const CONNECTORS: readonly Connector[] = [
  { id: 'gmail', toolkit: 'GMAIL', name: 'Gmail', family: 'google', reads: ['mail'], uses: 'Reads your recent mail for the briefs you run. Never sends, labels or deletes.' },
  { id: 'googlecalendar', toolkit: 'GOOGLECALENDAR', name: 'Google Calendar', family: 'google', reads: ['calendar'], uses: 'Reads the day’s meetings, so a brief can tell you what to prepare.' },
  { id: 'googledrive', toolkit: 'GOOGLEDRIVE', name: 'Google Drive', family: 'google', reads: ['updates'], uses: 'Sees which files changed recently, so a brief can point you to them. Never edits or shares.' },
  { id: 'outlook', toolkit: 'OUTLOOK', name: 'Outlook', family: 'microsoft', reads: ['mail', 'calendar'], uses: 'Reads your Outlook mail and calendar for the briefs you run.' },
  { id: 'microsoftteams', toolkit: 'MICROSOFT_TEAMS', name: 'Microsoft Teams', family: 'microsoft', reads: ['updates'], uses: 'Reads your recent chats and your Planner tasks. Never posts.' },
  { id: 'onedrive', toolkit: 'ONE_DRIVE', name: 'OneDrive', family: 'microsoft', reads: ['updates'], uses: 'Sees the files you worked on recently. Never edits or shares.' },
  { id: 'slack', toolkit: 'SLACK', name: 'Slack', family: 'team', reads: ['updates'], uses: 'Reads recent messages you can see, so a brief catches what needs you. Never posts or reacts.' },
  { id: 'zoom', toolkit: 'ZOOM', name: 'Zoom', family: 'team', reads: ['updates'], uses: 'Lists your upcoming meetings. Never creates or joins one.' },
  { id: 'notion', toolkit: 'NOTION', name: 'Notion', family: 'team', reads: ['updates'], uses: 'Sees which pages changed recently. Never edits.' },
  { id: 'dropbox', toolkit: 'DROPBOX', name: 'Dropbox', family: 'team', reads: ['updates'], uses: 'Sees the files that changed recently. Never edits or shares.' },
  { id: 'box', toolkit: 'BOX', name: 'Box', family: 'team', reads: ['updates'], uses: 'Sees the files you opened recently. Never edits or shares.' },
  { id: 'calendly', toolkit: 'CALENDLY', name: 'Calendly', family: 'team', reads: ['updates'], uses: 'Lists the meetings people booked with you. Never books or cancels.' },
  { id: 'github', toolkit: 'GITHUB', name: 'GitHub', family: 'work', reads: ['updates'], uses: 'Reads your notifications, the issues assigned to you and what happened in your repositories. Never comments or merges.' },
  { id: 'jira', toolkit: 'JIRA', name: 'Jira', family: 'work', reads: ['updates'], uses: 'Reads the issues assigned to you that changed recently. Never edits.' },
  { id: 'trello', toolkit: 'TRELLO', name: 'Trello', family: 'work', reads: ['updates'], uses: 'Reads your unread notifications. Never moves or edits cards.' },
  { id: 'hubspot', toolkit: 'HUBSPOT', name: 'HubSpot', family: 'work', reads: ['updates'], uses: 'Reads recent calls, meetings, notes and tasks on your records. Never edits.' },
  { id: 'gitlab', toolkit: 'GITLAB', name: 'GitLab', family: 'work', reads: ['updates'], uses: 'Reads the open issues assigned to you. Never comments or merges.' },
  { id: 'figma', toolkit: 'FIGMA', name: 'Figma', family: 'work', reads: ['updates'], needsTeam: true, uses: 'Sees which design files in your team changed recently. Never edits or comments.' },
  { id: 'linear', toolkit: 'LINEAR', name: 'Linear', family: 'work', reads: ['updates'], uses: 'Reads the issues assigned to you. Never edits.' },
  { id: 'asana', toolkit: 'ASANA', name: 'Asana', family: 'work', reads: ['updates'], uses: 'Reads the tasks assigned to you. Never completes or edits.' },
  { id: 'confluence', toolkit: 'CONFLUENCE', name: 'Confluence', family: 'work', reads: ['updates'], uses: 'Sees the pages changed recently. Never edits.' },
  { id: 'googlesheets', toolkit: 'GOOGLESHEETS', name: 'Google Sheets', family: 'google', reads: ['updates'], uses: 'Finds and reads the spreadsheets you ask about. Adds rows only when you press «Add rows».' },
  { id: 'googledocs', toolkit: 'GOOGLEDOCS', name: 'Google Docs', family: 'google', reads: ['updates'], uses: 'Finds and reads the documents you ask about. Never edits or shares.' },
  { id: 'googlemeet', toolkit: 'GOOGLEMEET', name: 'Google Meet', family: 'google', reads: ['updates'], uses: 'Reads the transcripts of your recorded meetings, for notes and scorecards. Never joins or records.' },
  { id: 'linkedin', toolkit: 'LINKEDIN', name: 'LinkedIn', family: 'sales', reads: [], uses: 'Posts only a post you approved, when you press «Post to LinkedIn». Never reads your messages.' },
  { id: 'salesforce', toolkit: 'SALESFORCE', name: 'Salesforce', family: 'sales', reads: ['updates'], uses: 'Reads your opportunities, leads and accounts. Never edits.' },
  { id: 'airtable', toolkit: 'AIRTABLE', name: 'Airtable', family: 'sales', reads: ['updates'], uses: 'Reads the bases and records you ask about. Never edits.' },
];

export const CONNECTOR_BY_ID: Readonly<Record<ConnectorId, Connector>> =
  Object.fromEntries(CONNECTORS.map(connector => [connector.id, connector])) as Record<ConnectorId, Connector>;

export const FAMILY_LABEL: Record<ConnectorFamily, string> = { google: 'Google Workspace', microsoft: 'Microsoft 365', team: 'Chat, meetings and files', work: 'Code, projects and sales', sales: 'Sales & social' };
export const FAMILIES: readonly ConnectorFamily[] = ['google', 'microsoft', 'team', 'work', 'sales'];

export const isConnectorId = (value: unknown): value is ConnectorId =>
  typeof value === 'string' && (CONNECTOR_IDS as readonly string[]).includes(value);
export const readsMail = (id: ConnectorId) => CONNECTOR_BY_ID[id].reads.includes('mail');
export const readsCalendar = (id: ConnectorId) => CONNECTOR_BY_ID[id].reads.includes('calendar');
export const readsUpdates = (id: ConnectorId) => CONNECTOR_BY_ID[id].reads.includes('updates');

/** One service's state for the owner. */
export type ConnectionState = { id: ConnectorId; connected: boolean; since?: string; /** Figma: whether the team link is saved. */ teamSet?: boolean;
  /** 13 Nov 2026: false when the server has no Composio sign-in (auth config) for this app yet: one setup step. */ ready?: boolean };
/** available: Composio is set up on the server. ownerSet: the server has an owner code. owner: this browser showed it. */
export type ConnectionsReply = { available: boolean; ownerSet: boolean; owner: boolean; signedIn?: boolean; services: ConnectionState[] };

/** The header the browser sends the owner code in. */
export const OWNER_HEADER = 'X-Owner-Code';
