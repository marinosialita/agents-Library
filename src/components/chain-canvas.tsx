// The chain as a map (11 Nov 2026, his request): React Flow (@xyflow/react 12.12.0, MIT) draws the task, each step and
// the result, joined left to right, and lights each step as a run goes. Read-only: steps are edited in the list below;
// a click on a step scrolls to it. Loaded only when a chain is open (React.lazy in chains.tsx).
import React, { useEffect, useMemo } from 'react';
import { Background, Handle, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { CircleAlert, CircleCheck, FileText, Flag, Loader2, Sparkles } from 'lucide-react';

export type CanvasStep = { agentName: string; ask: string; status?: 'waiting' | 'working' | 'done' | 'failed' | 'stopped' };
type Data = { kind: 'task' | 'step' | 'result'; title: string; text: string; status?: CanvasStep['status']; n?: number; onOpen?(): void; low?: boolean; /** One straight row (short chains). */ row?: boolean };

function ChainNode({ data }: NodeProps<Node<Data>>) {
  const Icon = data.kind === 'task' ? FileText : data.kind === 'result' ? Flag : null;
  return <div className={`mn-cc-node is-${data.kind}${data.status ? ` is-${data.status}` : ''}`} onClick={data.onOpen} role={data.onOpen ? 'button' : undefined}>
    {/* Two staggered rows: a top card leaves from its bottom edge, a bottom card from its top edge. */}
    {data.kind !== 'task' && <Handle type="target" position={data.row ? Position.Left : data.low ? Position.Top : Position.Bottom} isConnectable={false} />}
    <span className="mn-cc-top">
      {Icon ? <span className="mn-cc-badge"><Icon size={13} aria-hidden="true" /></span> : <span className="mn-cc-badge is-n">{data.n}</span>}
      <b>{data.title}</b>
      {data.status === 'working' ? <Loader2 size={14} className="mn-conn-spin mn-cc-state" aria-label="Working" />
        : data.status === 'done' ? <CircleCheck size={14} className="mn-cc-state is-ok" aria-label="Done" />
        : data.status === 'failed' || data.status === 'stopped' ? <CircleAlert size={14} className="mn-cc-state is-bad" aria-label="Did not finish" />
        : data.kind === 'step' ? <Sparkles size={13} className="mn-cc-state" aria-hidden="true" /> : null}
    </span>
    <small>{data.text}</small>
    {data.kind !== 'result' && <Handle type="source" position={data.row ? Position.Right : data.low ? Position.Top : Position.Bottom} isConnectable={false} />}
  </div>;
}
const nodeTypes = { chain: ChainNode };

export default function ChainCanvas({ steps, task, documents, onOpenStep }: { steps: CanvasStep[]; task: string; documents: number; onOpenStep(index: number): void }) {
  const { nodes, edges } = useMemo(() => {
    const GAP = 150;
    const all: Data[] = [
      { kind: 'task', title: 'Your task', text: task.trim() ? task.trim().slice(0, 90) : documents ? `${documents} document${documents === 1 ? '' : 's'}` : 'Write the task below' },
      ...steps.map((step, index): Data => ({ kind: 'step', n: index + 1, title: step.agentName || 'Choose an agent', text: step.ask.trim().slice(0, 90) || 'Does its own part', status: step.status, onOpen: () => onOpenStep(index) })),
      { kind: 'result', title: 'Result', text: steps.at(-1)?.status === 'done' ? 'Ready: open the last step' : 'The last step’s answer', status: steps.at(-1)?.status === 'done' ? 'done' : undefined },
    ];
    // 13 Nov 2026: a two-step chain zigzagged (task down to step 1, back up to step 2, down to the result). Up to three
    // steps read as one straight line, left to right; longer chains keep two staggered rows so the cards stay legible.
    const row = all.length <= 5;
    const nodes: Node<Data>[] = all.map((data, index) => ({ id: `n${index}`, type: 'chain', position: row ? { x: index * 250, y: 0 } : { x: index * GAP, y: index % 2 ? 118 : 0 }, data: { ...data, low: !row && index % 2 === 1, row }, draggable: false, selectable: false, connectable: false }));
    const edges: Edge[] = nodes.slice(1).map((node, index) => {
      const from = all[index]; const live = from.status === 'done' || from.kind === 'task';
      return { id: `e${index}`, source: `n${index}`, target: node.id, type: 'default', animated: all[index + 1].status === 'working', className: live ? 'is-live' : undefined };
    });
    return { nodes, edges };
  }, [steps, task, documents, onOpenStep]);
  // 13 Nov 2026 (the map went blank while a chain ran, and while the task was typed): React Flow 12 measures each node
  // through onNodesChange; nodes rebuilt without it lost their size and stayed hidden. The nodes live in its own state,
  // and a rebuild keeps each node's measured size.
  const [shown, setShown, onNodesChange] = useNodesState<Node<Data>>(nodes);
  useEffect(() => { setShown(current => nodes.map(node => { const before = current.find(item => item.id === node.id); return before?.measured ? { ...node, measured: before.measured } : node; })); }, [nodes, setShown]);
  return <div className={`mn-cc${steps.length <= 3 ? ' is-row' : ''}`} aria-label="The chain as a map">
    {/* 13 Nov 2026: a step added or removed left the map framed for the old size (the result was cut off): it is framed again. */}
    <ReactFlow key={steps.length} nodes={shown} onNodesChange={onNodesChange} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.35} maxZoom={1.2}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false} panOnScroll={false} proOptions={{ hideAttribution: false }}>
      <Background gap={18} size={1} />
    </ReactFlow>
  </div>;
}
