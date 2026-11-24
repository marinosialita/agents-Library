// «Updates» from the apps beyond mail and calendar (11 Nov 2026): recent messages, notifications, changed files, assigned
// tasks and upcoming meetings, read-only. Every tool slug and argument below is Composio's own, read on
// https://docs.composio.dev/toolkits/<slug>.md on 11 Nov 2026; none of them sends, posts, edits or deletes. One shape
// for all of them, so the agent has one tool (list_updates) and the names guard sees every field.
import type { ConnectorId } from '../../shared/connections.ts';
import { cleanText, itemsOf } from './inbox.ts';

export type UpdateKind = 'message' | 'notification' | 'file' | 'page' | 'task' | 'meeting' | 'activity';
export type UpdateItem = { id: string; service: ConnectorId; kind: UpdateKind; title: string; from: string; at: string; text: string; link: string };
export type UpdateQuery = { since: number; hours: number; max: number; timeZone: string; /** Figma's team, from server/connected/settings.ts. */ teamId?: string };
export class NeedsSetting extends Error {}
type Exec = (slug: string, args: Record<string, unknown>) => Promise<unknown>;
type Reader = (exec: Exec, query: UpdateQuery) => Promise<{ kind: UpdateKind; items: unknown[] }[]>;

const iso = (ms: number) => new Date(ms).toISOString();
const one = (kind: UpdateKind, data: unknown) => [{ kind, items: itemsOf(data) }];

/** The read-only reader for each app. */
export const UPDATE_READERS: Partial<Record<ConnectorId, Reader>> = {
  googledrive: async (exec, q) => one('file', await exec('GOOGLEDRIVE_LIST_FILES', { q: `modifiedTime > '${iso(q.since)}' and trashed = false`, orderBy: 'modifiedTime desc', pageSize: q.max,
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName))' })),
  onedrive: async (exec, q) => one('file', await exec('ONE_DRIVE_GET_RECENT_ITEMS', { top: q.max })),
  microsoftteams: async (exec, q) => {
    const chats = itemsOf(await exec('MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS', { top: 10 })).slice(0, 5);
    const messages = (await Promise.all(chats.map(chat => { const id = (chat as { id?: unknown })?.id;
      return typeof id === 'string' ? exec('MICROSOFT_TEAMS_TEAMS_LIST_CHAT_MESSAGES', { chat_id: id, top: 5 }).then(itemsOf, () => []) : Promise.resolve([]); }))).flat();
    const tasks = await exec('MICROSOFT_TEAMS_LIST_MY_PLANNER_TASKS', {}).then(itemsOf, () => []);
    return [{ kind: 'message', items: messages }, { kind: 'task', items: tasks }];
  },
  // Slack's search takes a day, not an hour: ask from the day before, then keep only what falls in the window.
  slack: async (exec, q) => one('message', await exec('SLACK_SEARCH_MESSAGES', { query: `after:${iso(q.since - 86_400_000).slice(0, 10)}`, count: q.max, sort: 'timestamp', sort_dir: 'desc' })),
  zoom: async (exec, q) => one('meeting', await exec('ZOOM_LIST_MEETINGS', { user_id: 'me', type: 'upcoming', page_size: q.max, timezone: q.timeZone })),
  notion: async (exec, q) => one('page', await exec('NOTION_SEARCH_NOTION_PAGE', { query: '', direction: 'descending', timestamp: 'last_edited_time', page_size: q.max })),
  dropbox: async exec => one('file', await exec('DROPBOX_LIST_FILES_IN_FOLDER', { path: '', recursive: true, limit: 200 })),
  // GitHub (11 Nov 2026, his «a brief of what happened in my github» came back empty): notifications, read or not, the
  // issues assigned to you, and what happened in your own repositories pushed in the window (pushes, branches, pull
  // requests), from each repository's activity feed. The user feed (GITHUB_LIST_EVENTS_FOR_THE_AUTHENTICATED_USER)
  // fails on Composio («unexpected keyword argument 'metadata'», 11 Nov), so the repository feed is read instead.
  github: async (exec, q) => {
    const repos = (await exec('GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER', { sort: 'pushed', per_page: 5 }).then(itemsOf, () => []) as any[])
      .filter(repo => repo?.full_name && Date.parse(repo.pushed_at) >= q.since).slice(0, 3);
    const activity = (await Promise.all(repos.map(async repo => {
      const [owner, name] = String(repo.full_name).split('/');
      const events = await exec('GITHUB_LIST_REPOSITORY_EVENTS', { owner, repo: name, per_page: 30 }).then(itemsOf, () => []) as any[];
      return events.map(event => githubEvent(event, repo.full_name, repo.html_url)).filter(Boolean);
    }))).flat();
    return [
      { kind: 'notification', items: itemsOf(await exec('GITHUB_LIST_NOTIFICATIONS_FOR_THE_AUTHENTICATED_USER', { since: iso(q.since), per_page: q.max, all: true })) },
      { kind: 'task', items: await exec('GITHUB_LIST_ISSUES_ASSIGNED_TO_THE_AUTHENTICATED_USER', { filter: 'assigned', state: 'open', since: iso(q.since), sort: 'updated', per_page: q.max }).then(itemsOf, () => []) },
      { kind: 'activity', items: activity },
    ];
  },
  jira: async (exec, q) => one('task', await exec('JIRA_SEARCH_ISSUES', { jql: `assignee = currentUser() AND updated >= -${q.hours}h ORDER BY updated DESC`, max_results: q.max })),
  trello: async (exec, q) => one('notification', await exec('TRELLO_GET_MEMBERS_NOTIFICATIONS_BY_ID_MEMBER', { idMember: 'me', read_filter: 'unread', limit: String(q.max) })),
  // Box, Calendly, GitLab and Confluence (11 Nov 2026), from docs.composio.dev/toolkits/{box,calendly,gitlab,confluence}.md.
  box: async (exec, q) => one('file', await exec('BOX_LIST_RECENTLY_ACCESSED_ITEMS', { limit: q.max })),
  calendly: async (exec, q) => {
    // Calendly takes the user's full URI («me» is not accepted), so the current user is read first.
    const me = flatFields(await exec('CALENDLY_GET_CURRENT_USER', {})).get('uri');
    if (!me) return [];
    return one('meeting', await exec('CALENDLY_LIST_SCHEDULED_EVENTS', { user: me, status: 'active', min_start_time: iso(q.since), sort: 'start_time:asc', count: q.max }));
  },
  gitlab: async (exec, q) => one('task', await exec('GITLAB_LIST_ISSUES', { scope: 'assigned_to_me', state: 'opened', order_by: 'updated_at', sort: 'desc', per_page: q.max })),
  confluence: async (exec, q) => one('page', await exec('CONFLUENCE_CQL_SEARCH', { cql: `lastmodified >= now("-${q.hours}h") order by lastmodified desc`, limit: q.max })),
  // Figma, Linear and Asana (11 Nov 2026), from docs.composio.dev/toolkits/{figma,linear,asana}.md.
  figma: async (exec, q) => {
    if (!q.teamId) throw new NeedsSetting('figma_team');
    const projects = itemsOf(await exec('FIGMA_GET_PROJECTS_IN_A_TEAM', { team_id: q.teamId })).slice(0, 6);
    const files = (await Promise.all(projects.map(project => { const id = flatFields(project).get('id');
      return id ? exec('FIGMA_GET_FILES_IN_A_PROJECT', { project_id: id }).then(itemsOf, () => []) : Promise.resolve([]); }))).flat();
    // A Figma file has a key, not a link: the link is made from it.
    return [{ kind: 'file', items: files.map(file => { const key = flatFields(file).get('key'); return key && file && typeof file === 'object' ? { ...file, url: `https://www.figma.com/file/${key}` } : file; }) }];
  },
  linear: async (exec, q) => {
    const me = flatFields(await exec('LINEAR_GET_CURRENT_USER', {})).get('id');
    return me ? one('task', await exec('LINEAR_LIST_LINEAR_ISSUES', { assignee_id: me, first: q.max })) : [];
  },
  asana: async (exec, q) => {
    // Asana searches one workspace for one person: the current user gives both.
    // One record, read whole: its workspaces are a list inside it, not the reply's list.
    const user = await exec('ASANA_GET_CURRENT_USER', {});
    const me = flatFields(user).get('gid');
    const workspace = flatFields(listNamed(user, 'workspaces')[0]).get('gid');
    if (!me || !workspace) return [];
    return one('task', await exec('ASANA_SEARCH_TASKS_IN_WORKSPACE', { workspace_gid: workspace, assignee_any: [me], limit: q.max,
      opt_fields: ['name', 'notes', 'due_on', 'modified_at', 'completed', 'permalink_url', 'assignee.name'] }));
  },
  hubspot: async (exec, q) => one('activity', await exec('HUBSPOT_LIST_RECENTLY_MODIFIED_ENGAGEMENTS', { since: q.since, count: q.max })),
  // 13 Nov 2026 (docs.composio.dev/toolkits/<slug>.md read that day): changed spreadsheets and documents, recorded
  // meetings, opportunities, and the Airtable bases (their records are read with airtable_records on request).
  googlesheets: async (exec, q) => one('file', await exec('GOOGLESHEETS_SEARCH_SPREADSHEETS', { modified_after: iso(q.since), order_by: 'modifiedTime desc', max_results: q.max })),
  googledocs: async (exec, q) => one('file', await exec('GOOGLEDOCS_SEARCH_DOCUMENTS', { modified_after: iso(q.since), order_by: 'modifiedTime desc', max_results: q.max, response_detail: 'minimal' })),
  googlemeet: async (exec, q) => one('meeting', await exec('GOOGLEMEET_LIST_CONFERENCE_RECORDS', { filter: `start_time>="${iso(q.since)}"`, page_size: Math.min(q.max, 50) })),
  salesforce: async (exec, q) => one('activity', await exec('SALESFORCE_RUN_SOQL_QUERY', { query: `SELECT Id, Name, StageName, Amount, CloseDate, LastModifiedDate FROM Opportunity WHERE LastModifiedDate >= ${iso(q.since).replace(/\.\d{3}Z$/, 'Z')} ORDER BY LastModifiedDate DESC LIMIT ${Math.min(q.max, 50)}` })),
  airtable: async exec => one('file', await exec('AIRTABLE_LIST_BASES', {})),
};

/** The first array called `name` anywhere in a reply (Asana's user carries its workspaces). */
export function listNamed(value: unknown, name: string, depth = 0): unknown[] {
  if (!value || typeof value !== 'object' || depth > 4) return [];
  for (const [key, child] of Object.entries(value)) if (key.toLowerCase() === name && Array.isArray(child)) return child;
  for (const child of Object.values(value)) { const found = listNamed(child, name, depth + 1); if (found.length) return found; }
  return [];
}

/** Every leaf of an item, by its key lower-cased, nearest first (so «fields.summary» and «subject.title» are found). */
export function flatFields(value: unknown): Map<string, string> {
  const found = new Map<string, string>();
  let level: [string, unknown][] = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: [string, unknown][] = [];
    for (const [key, child] of level) {
      const name = key.toLowerCase();
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') { const text = String(child).trim(); if (text && !found.has(name)) found.set(name, text); }
      else if (Array.isArray(child)) { const texts = child.filter(item => typeof item === 'string').slice(0, 8); if (texts.length && !found.has(name)) found.set(name, texts.join(', ')); else child.slice(0, 3).forEach(item => item && typeof item === 'object' && next.push(...Object.entries(item))); }
      else if (child && typeof child === 'object') next.push(...Object.entries(child));
    }
    level = next;
  }
  return found;
}

/** Epoch seconds (Slack's «ts») or milliseconds (HubSpot) as ISO; anything else as the app wrote it. */
export function readableTime(value: string): string {
  if (/^\d{10}(\.\d+)?$/.test(value)) return iso(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return iso(Number(value));
  return value;
}

export function updateOf(service: ConnectorId, kind: UpdateKind, item: unknown): UpdateItem {
  const fields = flatFields(item);
  const pick = (...keys: string[]) => { for (const key of keys) { const value = fields.get(key); if (value) return value; } return ''; };
  const text = cleanText(pick('text', 'content', 'body', 'preview', 'description', 'agenda', 'reason', 'snippet'));
  return {
    id: pick('id', 'key', 'gid', 'uuid', 'ts', 'number', 'path_display'), service, kind,
    title: cleanText(pick('summary', 'title', 'name', 'subject', 'topic', 'plain_text', 'type')).slice(0, 240) || text.slice(0, 120),
    from: cleanText(pick('displayname', 'username', 'user_name', 'login', 'author', 'sender', 'from', 'real_name', 'fullname')).slice(0, 160),
    at: readableTime(pick('updated_at', 'updated', 'last_modified', 'lastmodified', 'modified_at', 'updatedat', 'modifiedtime', 'lastmodifieddatetime', 'last_edited_time', 'server_modified', 'createddatetime', 'created_at', 'start_time', 'timestamp', 'ts', 'date', 'created', 'lastupdated')),
    text: text.length > 400 ? `${text.slice(0, 400)} […]` : text,
    link: pick('permalink', 'html_url', 'webviewlink', 'weburl', 'join_url', 'url', 'shorturl'),
  };
}

/** One app's updates in the window, newest first. Items without a time (an open issue, an upcoming meeting) are kept. */
export async function readUpdates(service: ConnectorId, exec: Exec, query: UpdateQuery): Promise<UpdateItem[]> {
  const reader = UPDATE_READERS[service];
  if (!reader) return [];
  const groups = await reader(exec, query);
  const items = groups.flatMap(group => group.items.map(item => updateOf(service, group.kind, item))).filter(item => item.title || item.text);
  const time = (item: UpdateItem) => Date.parse(item.at);
  return items.filter(item => item.kind === 'meeting' || item.kind === 'task' || Number.isNaN(time(item)) || time(item) >= query.since)
    .sort((a, b) => (time(b) || 0) - (time(a) || 0)).slice(0, query.max);
}

/** One GitHub repository event as a plain line: what happened, in which repository, when and by whom. */
export function githubEvent(event: any, repo: string, link: string): { title: string; updated_at: string; login: string; html_url: string; text: string } | null {
  const payload = event?.payload ?? {}; const branch = String(payload.ref ?? '').replace(/^refs\/heads\//, '');
  const pull = payload.pull_request; const issue = payload.issue;
  const title = event?.type === 'PushEvent' ? (payload.size ?? payload.commits?.length) ? `Pushed ${payload.size ?? payload.commits.length} commit(s) to ${branch}` : `Pushed to ${branch}`
    : event?.type === 'CreateEvent' ? `Created ${payload.ref_type ?? 'branch'} ${payload.ref ?? ''}`.trim()
    : event?.type === 'DeleteEvent' ? `Deleted ${payload.ref_type ?? 'branch'} ${payload.ref ?? ''}`.trim()
    : event?.type === 'PullRequestEvent' && pull ? `Pull request #${pull.number} ${pull.merged ? 'merged' : payload.action}: ${pull.title}`
    : event?.type === 'IssuesEvent' && issue ? `Issue #${issue.number} ${payload.action}: ${issue.title}`
    : event?.type === 'IssueCommentEvent' && issue ? `Comment on #${issue.number}: ${issue.title}`
    : event?.type === 'PullRequestReviewEvent' && pull ? `Review on pull request #${pull.number}: ${pull.title}`
    : event?.type === 'ReleaseEvent' ? `Release ${payload.release?.tag_name ?? ''} ${payload.action ?? ''}`.trim() : '';
  if (!title || !event?.created_at) return null;
  const message = payload.commits?.[0]?.message ? String(payload.commits[0].message).split('\n')[0] : '';
  return { title: `${repo}: ${title}`, updated_at: event.created_at, login: event.actor?.login ?? '', html_url: pull?.html_url ?? issue?.html_url ?? link ?? '', text: message };
}
