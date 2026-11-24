// «Your privacy» (7 Nov 2026, his request): the promise a user can see, item by item, each marked by what this server
// really does today. Nothing is claimed that is not switched on: the EU processing and hosting items say «waits» until
// the owner has set them up.
import React, { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Lock } from 'lucide-react';
import { serverStatus, type ServerStatus } from '../data/api.ts';
import { updateSettings, type Settings } from '../data/store.ts';
import { ToolBar } from './nomos-chrome.tsx';

type Item = { title: string; text: string; state: 'on' | 'off' | 'waits' | 'checking'; action?: React.ReactNode };

export function PrivacyPage({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<ServerStatus | null | 'loading'>('loading');
  useEffect(() => { serverStatus().then(setStatus); }, []);
  const privacy = status && status !== 'loading' ? status.privacy : undefined;
  const checking = status === 'loading';
  const items: Item[] = [
    { title: 'Names are hidden before the AI sees anything', state: settings.hideNames ? 'on' : 'off',
      text: 'In your browser, names, companies, e-mail addresses, phone, ID, bank and card numbers and street addresses in your documents and messages become placeholders such as [PERSON 1]. The answer shows the real names again. Photos are the one exception: they go as they are, and only after you say so in that conversation.',
      action: <button type="button" className="nomos-btn" onClick={() => updateSettings({ hideNames: !settings.hideNames })}>{settings.hideNames ? 'Turn off' : 'Turn on'}</button> },
    { title: 'Your documents are read on your device', state: 'on',
      text: 'PDF and Word files are turned into text in your browser. Only the text a question needs travels to the AI; the file itself is never uploaded.' },
    { title: 'Your conversations stay in this browser', state: 'on',
      text: 'Conversations, agents, your house style and chains are kept in this browser only. There is no account and no copy on a server yet.' },
    { title: 'The AI provider does not train on your data', state: checking ? 'checking' : privacy?.storeOff ? 'on' : 'waits',
      text: 'Questions go to OpenAI’s API, whose data is not used to train its models unless the account owner opts in, and this service never opts in. Each request asks OpenAI not to store the answer. OpenAI may keep requests for up to 30 days to detect abuse, unless zero data retention is agreed for the account.' },
    { title: 'Processed in the European Union', state: checking ? 'checking' : privacy?.euProcessing ? 'on' : 'waits',
      text: privacy?.euProcessing ? 'Requests go to OpenAI’s European data-residency project: they are processed and stored in the EU.'
        : 'Waits for the owner: OpenAI’s European data residency needs a new EU project on the owner’s OpenAI account, then its address in the server settings.' },
    { title: 'This service runs in the European Union', state: checking ? 'checking' : privacy?.hostedInEu ? 'on' : 'waits',
      text: privacy?.hostedInEu ? `The server runs in the ${privacy.region} region (EU).` : 'Waits for the deployment: the server is set to run in Frankfurt (EU) once it is deployed. On this computer it runs locally.' },
    { title: 'Research reads official websites only', state: 'on',
      text: 'When an agent researches, the search is limited to the official websites of the place you chose, and every page it cites is checked against that list.' },
  ];
  const label = (state: Item['state']) => state === 'on' ? 'On' : state === 'off' ? 'Off' : state === 'checking' ? 'Checking…' : 'Waits';
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={Lock} title="Your privacy" />
    <div className="mn-pages-body">
      <p className="mn-pages-lead">What happens to what you give the agents, item by item, as this service works today. An item marked «Waits» is not true yet and says what it waits for.</p>
      <ul className="mn-privacy-list">{items.map(item => <li key={item.title} className={`is-${item.state}`}>
        <span className="mn-privacy-state">{item.state === 'on' ? <CircleCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}<small>{label(item.state)}</small></span>
        <span className="mn-privacy-text"><b>{item.title}</b><span>{item.text}</span></span>
        {item.action}
      </li>)}</ul>
    </div>
  </div>;
}
