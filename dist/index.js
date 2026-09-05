import z from "@deepseek-ai/schemastery";
import { ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";
import { z as z$1 } from "zod";
import { Service } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import { queueHostSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region src/config.ts
/**
* Deployment configuration for the team row. Every value is a cordis.yml knob;
* this plugin holds no hardcoded tunable.
*
* @module dsh-team/config
*/
/**
* The row's config schema; the loader validates before the service is built.
* Every key is defaulted, so a deployment may add the row with no options at
* all — the input type stays partial while the validated output is complete.
*/
const Config = z.object({
	provider: z.string().default("spawn"),
	maxTeammates: z.number().step(1).min(1).max(64).default(8),
	maxRecentMessages: z.number().step(1).min(1).max(1e3).default(50),
	maxChainHops: z.number().step(1).min(1).max(64).default(4),
	maxChainRoundTrips: z.number().step(1).min(1).max(64).default(2),
	maxWorkspaceEntries: z.number().step(1).min(1).max(500).default(32),
	maxNoteChars: z.number().step(1).min(200).max(2e5).default(4e3)
});
//#endregion
//#region src/command.ts
/**
* The standing instruction that makes `/team <goal>` mean "use the team":
* without it the leader would often just do the work solo, which is exactly
* what the user typed the command to avoid having to argue against.
*/
const BRIEF = "Pursue this request through your agent team rather than alone: decide what teammates the work needs, spawn them with team_spawn (each with a self-contained first task), coordinate them over team_send and the shared task list, and keep this session posted as results land.";
/** What the composer shows when the steering was accepted. */
const ACK = "The leader takes it from here: it will assemble and drive the team for this.";
/**
* The `/agent-teams` definition: one command, whole-goal input, image-capable.
* @returns the command definition for the registry.
*/
function teamCommand() {
	return {
		name: "agent-teams",
		description: "Hand a goal to an agent team: the main session spawns named teammates and coordinates them. Everything after the command becomes the team's brief.",
		input: {
			hint: "<what the team should do>",
			images: true
		},
		handler({ agent, rawInput, attachments }) {
			if (agent.session.header.origin === "subagent") return {
				kind: "error",
				text: "/agent-teams works in your main session — a teammate cannot lead a team."
			};
			const goal = rawInput.trim();
			if (goal.length === 0 && attachments.length === 0) return {
				kind: "error",
				text: "Tell /agent-teams what the team should do, e.g. \"/agent-teams migrate auth to the new SDK\"."
			};
			agent.steer(createUserMessage({
				content: [...attachments, {
					type: "text",
					text: goal.length === 0 ? BRIEF : `${BRIEF}\n\nRequest:\n${goal}`
				}],
				source: { kind: "user" }
			}));
			return {
				kind: "success",
				text: ACK
			};
		}
	};
}
/**
* Register {@link teamCommand} into the row's context.
* @param ctx - the row context; must carry `ctx.commands`.
* @returns the exact disposer unregistering the command.
*/
function installCommand(ctx) {
	return ctx.commands.register(teamCommand());
}
//#endregion
//#region src/contract.ts
/** The empty value every session without a team folds to. */
const EMPTY_TEAM_VIEW = {
	active: false,
	members: [],
	tasks: [],
	messages: [],
	board: []
};
/** The projection key this plugin owns. */
const TEAM_PROJECTION_KEY = "team";
//#endregion
//#region src/fold.ts
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asText(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function asCount(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
}
function asRelation(value) {
	return value === "managed" || value === "peer" ? value : void 0;
}
function asStatus(value) {
	return value === "pending" || value === "active" || value === "done" ? value : void 0;
}
/** Narrow one logged member fact, or reject it whole. */
function readMember(value) {
	const record = asRecord(value);
	if (record === void 0) return void 0;
	const memberId = asText(record["memberId"]);
	const name = asText(record["name"]);
	const relation = asRelation(record["relation"]);
	if (memberId === void 0 || name === void 0 || relation === void 0) return void 0;
	const role = asText(record["role"]);
	const model = asText(record["model"]);
	const effort = asText(record["effort"]);
	return {
		memberId,
		name,
		relation,
		...role !== void 0 ? { role } : {},
		...model !== void 0 ? { model } : {},
		...effort !== void 0 ? { effort } : {}
	};
}
/** Narrow one logged task fact, or reject it whole. */
function readTask(value) {
	const record = asRecord(value);
	if (record === void 0) return void 0;
	const taskId = asText(record["taskId"]);
	const title = asText(record["title"]);
	const status = asStatus(record["status"]);
	if (taskId === void 0 || title === void 0 || status === void 0) return void 0;
	const assigneeId = asText(record["assigneeId"]);
	const note = asText(record["note"]);
	return {
		taskId,
		title,
		status,
		...assigneeId !== void 0 ? { assigneeId } : {},
		...note !== void 0 ? { note } : {}
	};
}
/** Narrow one logged board entry, or reject it whole. */
function readBoardEntry(value) {
	const record = asRecord(value);
	if (record === void 0) return void 0;
	const key = asText(record["key"]);
	const authorId = asText(record["authorId"]);
	const authorName = asText(record["authorName"]);
	const updatedAt = asCount(record["updatedAt"]);
	if (key === void 0 || authorId === void 0 || authorName === void 0 || updatedAt === void 0) return;
	return {
		key,
		authorId,
		authorName,
		updatedAt,
		preview: asText(record["preview"]) ?? ""
	};
}
/** Narrow one logged team fact off a `tool/result` event's `meta`. */
function readFact(meta) {
	const record = asRecord(meta);
	if (record === void 0) return void 0;
	switch (record["team"]) {
		case "member-added":
		case "member-updated": {
			const member = readMember(record["member"]);
			return member === void 0 ? void 0 : {
				team: record["team"] === "member-added" ? "member-added" : "member-updated",
				member
			};
		}
		case "member-removed": {
			const memberId = asText(record["memberId"]);
			return memberId === void 0 ? void 0 : {
				team: "member-removed",
				memberId
			};
		}
		case "ended": return { team: "ended" };
		case "message": {
			const messageId = asText(record["messageId"]);
			const to = asText(record["to"]);
			if (messageId === void 0 || to === void 0) return void 0;
			const hop = asCount(record["hop"]);
			return {
				team: "message",
				messageId,
				to,
				text: asText(record["text"]) ?? "",
				...hop !== void 0 ? { hop } : {}
			};
		}
		case "task": {
			const task = readTask(record["task"]);
			return task === void 0 ? void 0 : {
				team: "task",
				task
			};
		}
		case "board": {
			const rows = record["entries"];
			const at = asCount(record["at"]);
			if (!Array.isArray(rows) || at === void 0) return void 0;
			return {
				team: "board",
				entries: rows.map(readBoardEntry).filter((entry) => entry !== void 0),
				at
			};
		}
		default: return;
	}
}
/**
* Narrow one delivered message's source into a mailbox row, or reject it.
*
* Team deliveries use `team-message`; current continuation messages use
* `agent-message`; historical report and settlement sources remain readable so
* existing leader logs keep their mailbox rows. The latter sources can also
* come from ordinary subagents, so the caller keeps only roster members.
*/
function readIncoming(source) {
	const record = asRecord(source);
	if (record === void 0) return void 0;
	const kind = record["kind"];
	if (kind !== "team-message" && kind !== "agent-message" && kind !== "subagent-report" && kind !== "subagent-settled") return void 0;
	const senderSessionId = asText(record["senderSessionId"]);
	if (senderSessionId === void 0) return void 0;
	const senderName = asText(record["senderName"]);
	const hop = asCount(record["hop"]);
	return {
		senderSessionId,
		...senderName !== void 0 ? { senderName } : {},
		...hop !== void 0 ? { hop } : {},
		kind: kind === "team-message" || kind === "agent-message" ? "message" : kind === "subagent-report" ? "report" : "settled"
	};
}
/** Append one row to the bounded feed. */
function appended(messages, row, bound) {
	const next = [...messages, row];
	return next.length > bound ? next.slice(next.length - bound) : next;
}
/** Replace one member in place, or append it when the id is new. */
function upsertMember(members, member) {
	const index = members.findIndex((candidate) => candidate.memberId === member.memberId);
	if (index < 0) return [...members, member];
	const next = [...members];
	next[index] = member;
	return next;
}
/** Replace one task in place, or append it when the id is new. */
function upsertTask(tasks, task) {
	const index = tasks.findIndex((candidate) => candidate.taskId === task.taskId);
	if (index < 0) return [...tasks, task];
	const next = [...tasks];
	next[index] = task;
	return next;
}
/** Apply one settled team fact to the view. */
function applyFact(view, fact, time, bound) {
	switch (fact.team) {
		case "member-added": return {
			...view,
			active: true,
			members: upsertMember(view.members, {
				...fact.member,
				joinedAt: time
			})
		};
		case "member-updated": {
			const previous = view.members.find((candidate) => candidate.memberId === fact.member.memberId);
			if (previous === void 0) return view;
			return {
				...view,
				members: upsertMember(view.members, {
					...fact.member,
					joinedAt: previous.joinedAt
				})
			};
		}
		case "member-removed": return {
			...view,
			members: view.members.filter((candidate) => candidate.memberId !== fact.memberId)
		};
		case "ended": return {
			active: false,
			members: [],
			tasks: [],
			messages: view.messages,
			board: []
		};
		case "message": return {
			...view,
			messages: appended(view.messages, {
				messageId: fact.messageId,
				to: fact.to,
				kind: "message",
				text: fact.text,
				time,
				...fact.hop !== void 0 ? { hop: fact.hop } : {}
			}, bound)
		};
		case "task": return {
			...view,
			tasks: upsertTask(view.tasks, fact.task)
		};
		case "board": return {
			...view,
			board: fact.entries,
			boardAt: fact.at
		};
	}
}
/**
* Apply one inbound delivery to the view, keeping only senders the roster
* knows: a plain subagent's report is not team traffic.
*/
function applyIncoming(view, incoming, messageId, text, time, bound) {
	if (!view.members.some((member) => member.memberId === incoming.senderSessionId)) return view;
	return {
		...view,
		messages: appended(view.messages, {
			messageId,
			from: incoming.senderSessionId,
			kind: incoming.kind,
			text,
			time,
			...incoming.hop !== void 0 ? { hop: incoming.hop } : {}
		}, bound)
	};
}
/** One-line account carried by a `notice`-form source, when it has one. */
function noticeText(source) {
	const record = asRecord(source);
	return record === void 0 ? void 0 : asText(record["summary"]);
}
/** First readable text block of a logged message's content. */
function textOf(content) {
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		const record = asRecord(block);
		if (record?.["type"] === "text") return asText(record["text"]) ?? "";
	}
	return "";
}
/**
* Fold one committed event into the team view.
*
* Returns the SAME reference for every event this unit does not own — the
* projection registry treats reference equality as "no downstream work".
* @param view - the state covering all prior events.
* @param event - the next committed session event.
* @param bound - mailbox feed length ceiling.
* @returns the next view, or `view` itself when nothing changed.
*/
function applyTeamEvent(view, event, bound) {
	if (event.type === "tool/result") {
		if (event.data.error !== void 0) return view;
		const fact = readFact(event.data.meta);
		return fact === void 0 ? view : applyFact(view, fact, event.time, bound);
	}
	if (event.type === "user/message") {
		const incoming = readIncoming(event.data.source);
		if (incoming === void 0) return view;
		const text = incoming.kind === "settled" ? noticeText(event.data.source) ?? textOf(event.data.content) : textOf(event.data.content);
		return applyIncoming(view, incoming, event.data.id, text, event.time, bound);
	}
	return view;
}
/**
* Fold a whole log — the cold path used by tests and by a service reading a
* session the projection registry has not driven.
* @param events - the session's events, in seq order.
* @param bound - mailbox feed length ceiling.
* @returns the folded view.
*/
function foldTeam(events, bound) {
	let view = EMPTY_TEAM_VIEW;
	for (const event of events) view = applyTeamEvent(view, event, bound);
	return view;
}
//#endregion
//#region src/projection.ts
/**
* The `team` session-projection unit: the host is the only place the team fold
* runs, and the framework serves its value to the browser (list baselines,
* history tail pages, and `session/projection` push frames) with no client-side
* folding at all.
*
* @module dsh-team/projection
*/
/**
* Wire validation for the served value. The unit's state IS the value, so one
* schema covers the fold state, the read side, and the persisted-cache round
* trip.
*/
const teamViewSchema = z$1.object({
	active: z$1.boolean(),
	members: z$1.array(z$1.object({
		memberId: z$1.string(),
		name: z$1.string(),
		role: z$1.string().optional(),
		relation: z$1.union([z$1.literal("managed"), z$1.literal("peer")]),
		model: z$1.string().optional(),
		effort: z$1.string().optional(),
		joinedAt: z$1.number()
	})),
	tasks: z$1.array(z$1.object({
		taskId: z$1.string(),
		title: z$1.string(),
		assigneeId: z$1.string().optional(),
		status: z$1.union([
			z$1.literal("pending"),
			z$1.literal("active"),
			z$1.literal("done")
		]),
		note: z$1.string().optional()
	})),
	messages: z$1.array(z$1.object({
		messageId: z$1.string(),
		from: z$1.string().optional(),
		to: z$1.string().optional(),
		kind: z$1.union([
			z$1.literal("message"),
			z$1.literal("report"),
			z$1.literal("settled")
		]),
		text: z$1.string(),
		time: z$1.number(),
		hop: z$1.number().optional()
	})),
	board: z$1.array(z$1.object({
		key: z$1.string(),
		authorId: z$1.string(),
		authorName: z$1.string(),
		updatedAt: z$1.number(),
		preview: z$1.string()
	})),
	boardAt: z$1.number().optional()
});
/**
* Build the projection unit for one deployment's mailbox bound.
* @param maxRecentMessages - feed ceiling from the row config.
* @returns the registrable unit.
*/
function teamProjection(maxRecentMessages) {
	return {
		key: "team",
		stateSchema: teamViewSchema,
		init: () => EMPTY_TEAM_VIEW,
		apply: (state, event) => applyTeamEvent(state, event, maxRecentMessages),
		wire: {
			viewSchema: teamViewSchema,
			view: (state) => state
		},
		stateVersion: 4
	};
}
//#endregion
//#region src/errors.ts
/** Stable sentence per code; `detail` appends the caller-specific part. */
const MESSAGES = {
	NO_TEAM: "no team here yet — spawn a teammate with team_spawn to start one",
	LEADER_AWAY: "your team is intact but its main session is not loaded right now, so nothing can be delivered through it. Your work is not lost: write what you have to the shared workspace with team_note, which needs nobody else, and stop — the leader reads it when it comes back",
	NESTED_TEAM: "a teammate cannot lead its own team; ask your leader to spawn one instead",
	MAX_TEAMMATES: "the team is full — dismiss a teammate before spawning another",
	DUPLICATE_NAME: "a teammate with that name is already on the roster",
	UNKNOWN_MEMBER: "no teammate with that id or name is on the roster",
	UNKNOWN_TASK: "no task with that id is on the shared task list",
	TASK_TITLE_REQUIRED: "a new task needs a title",
	SELF_MESSAGE: "a member cannot message itself",
	UNAUTHORIZED: "this team operation is not available to you",
	UNKNOWN_EFFORT: "that reasoning effort is not offered by the selected model",
	CHAIN_EXHAUSTED: "this conversation has relayed as far as it may between teammates — settle it yourself and report to the leader, which is never refused",
	PING_PONG: "you have already said your piece to this member in this conversation — decide with what you have, or raise it with the leader",
	REPEATED_MESSAGE: "you already sent that exact message in this conversation; sending it again changes nothing",
	INVALID_NOTE_KEY: "that note name cannot be stored",
	NOTE_TOO_LONG: "that note is longer than this workspace accepts — keep the conclusion, drop the transcript",
	WORKSPACE_FULL: "this workspace area is full",
	UNKNOWN_NOTE: "no note with that name is in this workspace area"
};
/** One refused team operation. */
var TeamError = class extends Error {
	code;
	detail;
	/**
	* @param code - the stable refusal code.
	* @param detail - the caller-specific part appended to the stable sentence.
	*/
	constructor(code, detail) {
		super(detail === void 0 ? MESSAGES[code] : `${MESSAGES[code]}: ${detail}`);
		this.code = code;
		this.detail = detail;
		this.name = "TeamError";
	}
};
//#endregion
//#region src/service.ts
/**
* The agent-team service: roster, mailbox routing with its relation-based
* authorization, the shared task list, and the team lifecycle.
*
* Teammates are NOT a private runtime. Each one is a continuable subagent of
* the leader (`ctx.subagents.startContinuable`), so the harness owns identity,
* residency, cold resume after a restart, interrupt, and the `origin:
* 'subagent'` session header that keeps a teammate out of the session tree and
* out of generic Host routing. What this service adds is what the subagent
* seam deliberately leaves out: named members, member-to-member delivery, and
* one shared task list.
*
* Delivery authority is always the leader's. `ctx.subagents` authorizes a
* follow-up against the durable direct-parent lineage only ("teams remain
* rejected until an explicit authority protocol has a production consumer"),
* and the leader IS every teammate's durable direct parent. A peer-to-peer
* message is therefore a leader-authorized delivery whose durable source names
* the real sender; `relation` decides who may ASK for it, never who may
* perform it.
*
* @module dsh-team/service
*/
/** How many recent conversation chains one team keeps enforcement state for. */
const CHAIN_MEMORY = 64;
/** `Context.team`: roster, mailbox routing, tasks, and team lifecycle. */
var TeamService = class extends Service {
	config;
	static inject = [
		"agents",
		"sessions",
		"subagents",
		"sessionProjections"
	];
	/** Live team per leader session id; rebuilt lazily from that session's log. */
	teams = /* @__PURE__ */ new Map();
	/** Spawns in flight, keyed by leader session id (team tools never overlap). */
	pending = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx, "team");
		this.config = config;
		ctx.on("agent/disposed", (payload) => {
			this.teams.delete(payload.agent.id);
			this.pending.delete(payload.agent.id);
		});
	}
	/**
	* The live team of one leader, rebuilt from its log on first touch. Nothing
	* is resumed here: a teammate materializes only when a message reaches it.
	* @param leader - the leader session's live agent.
	* @returns the mutable live team state.
	*/
	teamOf(leader) {
		const existing = this.teams.get(leader.id);
		if (existing !== void 0) return existing;
		const view = this.durableView(leader);
		const state = {
			active: view.active,
			members: new Map(view.members.map((member) => [member.memberId, memberFact(member)])),
			tasks: new Map(view.tasks.map((task) => [task.taskId, task])),
			inbox: /* @__PURE__ */ new Map(),
			chains: /* @__PURE__ */ new Map(),
			started: 0
		};
		this.teams.set(leader.id, state);
		return state;
	}
	/**
	* Adopt one continuable child into the team world while its scope is being
	* composed. Called from the teammate setup contribution after the child is
	* published — on cold resume the child is already on the leader's roster,
	* and only a child the roster has never seen can be the spawn currently in
	* flight.
	* @param child - the unpublished child agent.
	* @returns the membership facts, or undefined for a child outside any team.
	*/
	adopt(child) {
		const leaderId = child.session.header.parentSession;
		if (leaderId === void 0) return void 0;
		const leader = this.ctx.agents.get(leaderId);
		if (leader === void 0) return void 0;
		const team = this.teamOf(leader);
		const known = team.members.get(child.id);
		if (known !== void 0) return known;
		const pending = this.pending.get(leaderId);
		if (pending === void 0) return void 0;
		const fact = {
			...pending.fact,
			memberId: child.id
		};
		pending.claimed.push(child.id);
		team.members.set(child.id, fact);
		return fact;
	}
	/**
	* Spawn one teammate: a continuable subagent of the leader plus a roster row.
	* @param leader - the acting leader agent.
	* @param request - name, relation, initial task, and optional overrides.
	* @param signal - cancellation owning the operation until the teammate accepts its brief.
	* @returns the new member's durable facts.
	* @throws {TeamError} when the actor cannot lead, or the roster is full.
	*/
	async spawn(leader, request, signal) {
		if (leader.session.header.origin === "subagent") throw new TeamError("NESTED_TEAM");
		const team = this.teamOf(leader);
		if (team.members.size >= this.config.maxTeammates) throw new TeamError("MAX_TEAMMATES", String(this.config.maxTeammates));
		if (findByName(team, request.name) !== void 0) throw new TeamError("DUPLICATE_NAME", request.name);
		await this.assertEffortOffered(leader, request);
		const agentOptions = {
			...request.model !== void 0 ? { model: request.model } : {},
			...request.reasoningEffort !== void 0 ? { reasoningEffort: ReasoningEffortId(request.reasoningEffort) } : {}
		};
		const pending = {
			fact: {
				name: request.name,
				relation: request.relation,
				...request.role !== void 0 ? { role: request.role } : {},
				...request.model !== void 0 ? { model: request.model } : {},
				...request.reasoningEffort !== void 0 ? { effort: request.reasoningEffort } : {}
			},
			claimed: []
		};
		this.pending.set(leader.id, pending);
		let childId;
		try {
			childId = (await this.ctx.subagents.startContinuable({
				provider: this.config.provider,
				label: request.role === void 0 ? request.name : `${request.name} (${request.role})`,
				request: {
					parent: leader,
					prompt: [{
						type: "text",
						text: brief(request)
					}],
					...request.persona !== void 0 ? { persona: request.persona } : {},
					...Object.keys(agentOptions).length > 0 ? { agentOptions } : {}
				},
				signal
			})).childId;
		} catch (error) {
			for (const claimed of pending.claimed) team.members.delete(claimed);
			throw error;
		} finally {
			this.pending.delete(leader.id);
		}
		const fact = {
			...pending.fact,
			memberId: childId
		};
		team.members.set(childId, fact);
		team.active = true;
		this.ctx.emit("team/changed", { leaderId: leader.id });
		return fact;
	}
	/**
	* Deliver one mailbox message. The leader may message any teammate; a peer
	* teammate may message the leader or any other teammate; a managed teammate
	* may message only the leader.
	*
	* A teammate-to-teammate delivery also spends chain budget: it continues the
	* conversation its sender is working from, and that conversation may only
	* relay so far and may not repeat one ordered pair. Escalation to the leader
	* spends nothing, so the guard converges a peer exchange without ever
	* trapping a member with something to say.
	* @param from - the acting agent (leader or teammate).
	* @param to - recipient member id or member name; `leader` addresses the leader.
	* @param text - the message content.
	* @param signal - cancellation owning the delivery until inbox acceptance.
	* @returns the accepted message id, the resolved recipient, and the chain it joined.
	* @throws {TeamError} when the actor is outside the team, the recipient is
	*   unknown, the actor's relation forbids the delivery, or the conversation
	*   has spent its budget.
	*/
	async send(from, to, text, signal) {
		const actor = this.resolveActor(from);
		const recipient = this.resolveRecipient(actor, to);
		if (actor.member !== void 0 && actor.member.relation === "managed" && recipient.kind !== "leader") throw new TeamError("UNAUTHORIZED", `${actor.member.name} is a managed teammate and may only message the leader`);
		if (recipient.id === from.id) throw new TeamError("SELF_MESSAGE");
		const chain = this.chainFor(actor, from);
		if (recipient.kind === "member") this.assertBudget(actor.team, chain, from.id, recipient, text);
		const messageId = await this.deliver(actor, recipient, [{
			type: "text",
			text
		}], signal, chain);
		this.recordDelivery(actor.team, chain, from.id, recipient, text);
		return {
			messageId,
			recipient,
			chain
		};
	}
	/**
	* Create or update one shared task. Writes are the leader's: a teammate's
	* own tool calls land in its own log, which the leader's durable team state
	* never reads — teammates report, and the leader records the outcome.
	* @param leader - the acting leader agent.
	* @param spec - a new task (title) or an update to an existing one (taskId).
	* @returns the whole post-change task.
	* @throws {TeamError} when the actor is not the leader, the task is unknown,
	*   or the assignee is not on the roster.
	*/
	upsertTask(leader, spec) {
		const actor = this.resolveActor(leader);
		if (actor.member !== void 0) throw new TeamError("UNAUTHORIZED", "only the leader writes the task list");
		const assigneeId = spec.assigneeId === void 0 ? void 0 : this.resolveRecipient(actor, spec.assigneeId).id;
		if (spec.taskId === void 0) {
			if (spec.title === void 0) throw new TeamError("TASK_TITLE_REQUIRED");
			const task = {
				taskId: taskIdOf(actor.team),
				title: spec.title,
				status: spec.status ?? "pending",
				...assigneeId !== void 0 ? { assigneeId } : {},
				...spec.note !== void 0 ? { note: spec.note } : {}
			};
			actor.team.tasks.set(task.taskId, task);
			this.ctx.emit("team/changed", { leaderId: actor.leader.id });
			return task;
		}
		const previous = actor.team.tasks.get(spec.taskId);
		if (previous === void 0) throw new TeamError("UNKNOWN_TASK", spec.taskId);
		const task = {
			...previous,
			...spec.title !== void 0 ? { title: spec.title } : {},
			...spec.status !== void 0 ? { status: spec.status } : {},
			...assigneeId !== void 0 ? { assigneeId } : {},
			...spec.note !== void 0 ? { note: spec.note } : {}
		};
		actor.team.tasks.set(task.taskId, task);
		this.ctx.emit("team/changed", { leaderId: actor.leader.id });
		return task;
	}
	/**
	* Change one teammate's relationship level.
	* @param leader - the acting leader agent.
	* @param target - the teammate's member id or name.
	* @param relation - the new relation.
	* @returns the whole post-change member record.
	* @throws {TeamError} when the actor is not the leader or the member is unknown.
	*/
	setRelation(leader, target, relation) {
		const actor = this.resolveActor(leader);
		if (actor.member !== void 0) throw new TeamError("UNAUTHORIZED", "only the leader changes relations");
		const recipient = this.resolveRecipient(actor, target);
		if (recipient.kind !== "member") throw new TeamError("UNKNOWN_MEMBER", target);
		const fact = {
			...recipient.member,
			relation
		};
		actor.team.members.set(fact.memberId, fact);
		this.ctx.emit("team/changed", { leaderId: actor.leader.id });
		return fact;
	}
	/**
	* Dismiss one teammate, or end the whole team when no target is given. A
	* dismissed teammate stops its current turn and stops receiving mail; its
	* durable session stays readable through the subagent catalog.
	* @param leader - the acting leader agent.
	* @param target - the teammate's member id or name; absent ends the team.
	* @returns whether the team ended, plus the dismissed member id when targeted.
	* @throws {TeamError} when the actor is not the leader or the member is unknown.
	*/
	dismiss(leader, target) {
		const actor = this.resolveActor(leader);
		if (actor.member !== void 0) throw new TeamError("UNAUTHORIZED", "only the leader dismisses teammates");
		if (target === void 0) {
			for (const memberId of [...actor.team.members.keys()]) this.stopMember(actor.leader, memberId);
			actor.team.members.clear();
			actor.team.tasks.clear();
			actor.team.inbox.clear();
			actor.team.chains.clear();
			actor.team.active = false;
			this.ctx.emit("team/changed", {
				leaderId: actor.leader.id,
				ended: true
			});
			return { ended: true };
		}
		const recipient = this.resolveRecipient(actor, target);
		if (recipient.kind !== "member") throw new TeamError("UNKNOWN_MEMBER", target);
		this.stopMember(actor.leader, recipient.id);
		actor.team.members.delete(recipient.id);
		actor.team.inbox.delete(recipient.id);
		this.ctx.emit("team/changed", {
			leaderId: actor.leader.id,
			removedMember: recipient.id
		});
		return {
			ended: false,
			memberId: recipient.id
		};
	}
	/**
	* The roster, task list, and recent leader-visible mailbox traffic, from the
	* point of view of any member of the team.
	* @param actorAgent - the acting leader or teammate.
	* @returns the live team read; an inactive team reports empty lists.
	*/
	list(actorAgent) {
		const actor = this.tryResolveActor(actorAgent);
		if (actor === void 0) return {
			active: false,
			members: [],
			tasks: [],
			messages: []
		};
		const view = this.durableView(actor.leader);
		return {
			active: actor.team.active,
			members: [...actor.team.members.values()].map((member) => ({
				...member,
				joinedAt: view.members.find((row) => row.memberId === member.memberId)?.joinedAt ?? 0,
				status: this.statusOf(member.memberId)
			})),
			tasks: [...actor.team.tasks.values()],
			messages: [...view.messages]
		};
	}
	/**
	* Where one acting agent sits in its team: whose workspace it reaches, and
	* how a note it writes is attributed. The leader's own seat carries its
	* session id, so its private pad is addressed exactly like a teammate's.
	* @param agent - the acting leader or teammate.
	* @returns the team's leader id, the actor's own id, and its display name.
	* @throws {TeamError} when the actor is not in a team.
	*/
	seatOf(agent) {
		const actor = this.resolveActor(agent);
		return {
			leaderId: actor.leader.id,
			memberId: actor.member?.memberId ?? actor.leader.id,
			name: actor.member?.name ?? "leader"
		};
	}
	/**
	* The teammate roster as one teammate should see it, for its prompt section.
	* @param member - the teammate agent.
	* @returns the leader-relative roster, or undefined outside a team.
	*/
	rosterFor(member) {
		const actor = this.tryResolveActor(member);
		if (actor?.member === void 0) return void 0;
		return {
			self: actor.member,
			others: [...actor.team.members.values()].filter((row) => row.memberId !== member.id)
		};
	}
	/** The durable view the leader's log folds to (the projection registry's cached cut). */
	durableView(leader) {
		const registry = this.ctx.get("sessionProjections");
		if (registry === void 0) return foldTeam(leader.session.snapshotEvents(), this.config.maxRecentMessages);
		return registry.snapshot(leader.session).values.team ?? EMPTY_TEAM_VIEW;
	}
	/** Live runtime state of one teammate; `ready` means no live agent remains. */
	statusOf(memberId) {
		const agent = this.ctx.agents.get(SessionId(memberId));
		if (agent === void 0) return "ready";
		return agent.status === "running" ? "running" : "idle";
	}
	/**
	* Resolve the acting agent's team, or fail loud — and say WHICH failure it
	* is. A teammate whose leader session is simply not loaded is not a teammate
	* without a team: every delivery runs on the leader's parent authority, so
	* the mailbox is shut until the leader is back, while the workspace (which
	* needs nobody) stays open. Telling it "no team here yet" would send it to
	* spawn one, which it cannot do.
	*/
	resolveActor(agent) {
		const actor = this.tryResolveActor(agent);
		if (actor !== void 0) return actor;
		const leaderId = agent.session.header.parentSession;
		if (agent.session.header.origin === "subagent" && leaderId !== void 0 && this.ctx.agents.get(leaderId) === void 0) throw new TeamError("LEADER_AWAY");
		throw new TeamError("NO_TEAM");
	}
	/** Resolve the acting agent's team, or report absence. */
	tryResolveActor(agent) {
		if (agent.session.header.origin !== "subagent") return {
			leader: agent,
			team: this.teamOf(agent)
		};
		const leaderId = agent.session.header.parentSession;
		if (leaderId === void 0) return void 0;
		const leader = this.ctx.agents.get(leaderId);
		if (leader === void 0) return void 0;
		const team = this.teamOf(leader);
		const member = team.members.get(agent.id);
		return member === void 0 ? void 0 : {
			leader,
			team,
			member
		};
	}
	/** Resolve one address (member id, member name, or `leader`) to a recipient. */
	resolveRecipient(actor, address) {
		const normalized = address.trim();
		if (normalized.length === 0) throw new TeamError("UNKNOWN_MEMBER", address);
		if (normalized === actor.leader.id || normalized.toLowerCase() === "leader") return {
			kind: "leader",
			id: actor.leader.id,
			name: "leader"
		};
		const byId = actor.team.members.get(normalized);
		if (byId !== void 0) return {
			kind: "member",
			id: byId.memberId,
			name: byId.name,
			member: byId
		};
		const byName = findByName(actor.team, normalized);
		if (byName !== void 0) return {
			kind: "member",
			id: byName.memberId,
			name: byName.name,
			member: byName
		};
		throw new TeamError("UNKNOWN_MEMBER", address);
	}
	/**
	* The chain one send belongs to. A teammate continues the conversation it is
	* working from — that is what turns a peer exchange into one bounded
	* conversation instead of an unbounded sequence of unrelated messages. The
	* leader always opens a fresh chain: its own turns are the user-visible,
	* interruptible convergence point, so a conversation that reached the leader
	* has already converged and the next instruction starts over.
	*/
	chainFor(actor, from) {
		const inherited = actor.member === void 0 ? void 0 : actor.team.inbox.get(from.id);
		if (inherited !== void 0) return {
			chainId: inherited.chainId,
			hop: inherited.hop + 1
		};
		actor.team.started += 1;
		return {
			chainId: `c${actor.team.started}`,
			hop: 0
		};
	}
	/**
	* Refuse a peer delivery this conversation can no longer afford: too many
	* relays deep, one ordered pair talked out, or a verbatim repeat. Nothing
	* here applies to a message addressed to the leader.
	*/
	assertBudget(team, chain, fromId, recipient, text) {
		if (chain.hop > this.config.maxChainHops) throw new TeamError("CHAIN_EXHAUSTED", `relay ${chain.hop} of at most ${this.config.maxChainHops}`);
		const record = team.chains.get(chain.chainId);
		if (record === void 0) return;
		const edge = edgeKey(fromId, recipient.id);
		if ((record.edges.get(edge) ?? 0) >= this.config.maxChainRoundTrips) throw new TeamError("PING_PONG", `${this.config.maxChainRoundTrips} message(s) already went to ${recipient.name} in this conversation`);
		if (record.said.get(edge) === text) throw new TeamError("REPEATED_MESSAGE", recipient.name);
	}
	/** Charge one accepted peer delivery to its chain, and hand the chain on. */
	recordDelivery(team, chain, fromId, recipient, text) {
		if (recipient.kind !== "member") return;
		team.inbox.set(recipient.id, chain);
		let record = team.chains.get(chain.chainId);
		if (record === void 0) {
			record = {
				edges: /* @__PURE__ */ new Map(),
				said: /* @__PURE__ */ new Map()
			};
			team.chains.set(chain.chainId, record);
			for (const stale of team.chains.keys()) {
				if (team.chains.size <= CHAIN_MEMORY) break;
				team.chains.delete(stale);
			}
		}
		const edge = edgeKey(fromId, recipient.id);
		record.edges.set(edge, (record.edges.get(edge) ?? 0) + 1);
		record.said.set(edge, text);
	}
	/** Deliver one message, choosing the transport the recipient's runtime requires. */
	async deliver(actor, recipient, content, signal, chain) {
		const source = {
			kind: "team-message",
			form: "relay",
			senderSessionId: actor.member?.memberId ?? actor.leader.id,
			senderName: actor.member?.name ?? "leader",
			chainId: chain.chainId,
			hop: chain.hop
		};
		if (recipient.kind === "leader") {
			const message = createUserMessage({
				content,
				source
			});
			actor.leader.send(message, "next-turn", true);
			return message.id;
		}
		return await queueHostSubagentPrompt(this.ctx.subagents, actor.leader, SessionId(recipient.id), content, source, signal);
	}
	/**
	* Reject a reasoning effort the selected model does not offer, at spawn
	* rather than on the teammate's every later request. Validation needs an
	* exact provider/model route: without one the adapter stays the authority.
	*/
	async assertEffortOffered(leader, request) {
		if (request.reasoningEffort === void 0) return;
		const llm = this.ctx.get("llm");
		const provider = leader.options.provider;
		const model = request.model ?? leader.options.model;
		if (llm === void 0 || provider === void 0 || model === void 0) return;
		const offered = (await llm.resolveModelInfo(provider, model)).reasoning?.efforts ?? [];
		if (offered.some((effort) => effort.id === request.reasoningEffort)) return;
		throw new TeamError("UNKNOWN_EFFORT", offered.length === 0 ? `${model} exposes no reasoning efforts` : `${model} offers ${offered.map((effort) => effort.id).join(", ")}`);
	}
	/**
	* Stop one teammate's current work. Residency belongs to the continuation
	* manager, so dismissal interrupts rather than disposes: an interrupted
	* teammate settles on its own and its session stays readable.
	*/
	stopMember(leader, memberId) {
		try {
			this.ctx.subagents.interrupt(SessionId(memberId), {
				kind: "ancestor",
				agent: leader
			});
		} catch (error) {
			this.ctx.logger.warn("dsh-team: interrupt of teammate %s failed: %s", memberId, String(error));
		}
	}
	/** Service teardown: live teams are rebuilt from their logs on next touch. */
	stop() {
		this.teams.clear();
		this.pending.clear();
	}
};
/** Strip the live-view fields a roster fact does not carry. */
function memberFact(member) {
	return {
		memberId: member.memberId,
		name: member.name,
		relation: member.relation,
		...member.role !== void 0 ? { role: member.role } : {},
		...member.model !== void 0 ? { model: member.model } : {},
		...member.effort !== void 0 ? { effort: member.effort } : {}
	};
}
/** One ordered pair, as the chain ledger keys it. */
function edgeKey(fromId, toId) {
	return `${fromId} ${toId}`;
}
/** Case-insensitive roster lookup by display name. */
function findByName(team, name) {
	const wanted = name.trim().toLowerCase();
	for (const member of team.members.values()) if (member.name.toLowerCase() === wanted) return member;
}
/** Short stable task id, unique within one team's live list. */
function taskIdOf(team) {
	let next = team.tasks.size + 1;
	while (team.tasks.has(`t${next}`)) next += 1;
	return `t${next}`;
}
/** The teammate's first turn: who it is, and what the leader asked for. */
function brief(request) {
	return [
		request.role === void 0 ? `You are ${request.name}, a teammate in this agent team.` : `You are ${request.name} (${request.role}), a teammate in this agent team.`,
		"",
		"The leader assigned you this task:",
		request.task
	].join("\n");
}
//#endregion
//#region src/workspace.ts
/** Keys a member may name: readable, bounded, and free of the record separator. */
const KEY_PATTERN = /^[\w .\-一-鿿]{1,64}$/u;
/** Longest preview one board entry contributes to the leader's projection. */
const PREVIEW_CHARS = 180;
/** The shared area's stable id; every other area id is a member's session id. */
const SHARED_AREA = "shared";
/** One stored note, whole: the record IS the entity, never a delta. */
const entrySchema = z$1.object({
	/** The leader session whose team owns this workspace. */
	leaderId: z$1.string(),
	/** `shared`, or the session id of the member whose private pad this is. */
	area: z$1.string(),
	key: z$1.string(),
	text: z$1.string(),
	authorId: z$1.string(),
	authorName: z$1.string(),
	updatedAt: z$1.number()
});
/** The domain this plugin owns: one table of notes across every team. */
const WORKSPACE_DOMAIN = defineDomain({
	name: "team_workspace",
	version: 1,
	tables: { entries: domainTable(entrySchema) }
});
/** Record address: leader, area, and key, in one line-separated string. */
function recordKey(leaderId, area, key) {
	return `${leaderId}\n${area}\n${key}`;
}
/** Reject a key the model invented that would not survive as an address. */
function assertKey(key) {
	const trimmed = key.trim();
	if (!KEY_PATTERN.test(trimmed)) throw new TeamError("INVALID_NOTE_KEY", "use up to 64 letters, digits, spaces, dots, or dashes");
	return trimmed;
}
/** The one-line preview the leader's projection carries for one entry. */
function previewOf(text) {
	const line = text.split("\n").find((part) => part.trim().length > 0)?.trim() ?? "";
	return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}…` : line;
}
/** Newest first: a workspace is read from the top. */
function byNewest(left, right) {
	return right.updatedAt - left.updatedAt;
}
/**
* The team workspaces over one open storage domain. One instance serves every
* team in the process; records carry their own leader and area, so a read is a
* filter and no two teams can see each other's notes.
*/
var TeamWorkspace = class {
	config;
	opening;
	disposed = false;
	/**
	* @param ctx - a context whose `storageDomain` is already resolved.
	* @param config - the row config carrying the workspace bounds.
	*/
	constructor(ctx, config) {
		this.config = config;
		this.opening = ctx.storageDomain.open(WORKSPACE_DOMAIN);
		this.opening.then((domain) => {
			if (this.disposed) domain.close();
		}, () => void 0);
	}
	/**
	* Read one area of one team's workspace, newest first.
	* @param leaderId - the team's leader session id.
	* @param area - {@link SHARED_AREA} or a member's session id.
	* @returns the notes in that area.
	*/
	async read(leaderId, area) {
		const table = (await this.opening).table("entries");
		const found = [];
		for (const [, entry] of table.entries()) if (entry.leaderId === leaderId && entry.area === area) found.push(entry);
		return found.sort(byNewest);
	}
	/**
	* Write one note, replacing whatever the key held.
	* @param leaderId - the team's leader session id.
	* @param area - {@link SHARED_AREA} or the author's own session id.
	* @param key - the note's name, as the model gave it.
	* @param text - the whole note body.
	* @param author - who is writing.
	* @param now - epoch ms recorded on the note.
	* @returns the stored note.
	* @throws {TeamError} on an unusable key, an oversized note, or a full area.
	*/
	async write(leaderId, area, key, text, author, now) {
		const name = assertKey(key);
		if (text.length > this.config.maxNoteChars) throw new TeamError("NOTE_TOO_LONG", `${text.length} of at most ${this.config.maxNoteChars} characters`);
		const table = (await this.opening).table("entries");
		const address = recordKey(leaderId, area, name);
		if (table.get(address) === void 0) {
			if ((await this.read(leaderId, area)).length >= this.config.maxWorkspaceEntries) throw new TeamError("WORKSPACE_FULL", `${this.config.maxWorkspaceEntries} notes already — replace or drop one before adding another`);
		}
		const entry = {
			leaderId,
			area,
			key: name,
			text,
			authorId: author.id,
			authorName: author.name,
			updatedAt: now
		};
		await table.put(address, entry);
		return entry;
	}
	/**
	* Drop one note.
	* @param leaderId - the team's leader session id.
	* @param area - the area holding it.
	* @param key - the note's name.
	* @throws {TeamError} when no note of that name is in the area.
	*/
	async remove(leaderId, area, key) {
		const name = assertKey(key);
		if (!await (await this.opening).table("entries").delete(recordKey(leaderId, area, name))) throw new TeamError("UNKNOWN_NOTE", name);
	}
	/**
	* Drop everything one area holds — a dismissed member's private pad, or a
	* disbanded team's whole workspace.
	* @param leaderId - the team's leader session id.
	* @param area - one area, or undefined for every area of this team.
	*/
	async clear(leaderId, area) {
		const table = (await this.opening).table("entries");
		const doomed = [];
		for (const [address, entry] of table.entries()) if (entry.leaderId === leaderId && (area === void 0 || entry.area === area)) doomed.push(address);
		for (const address of doomed) await table.delete(address);
	}
	/**
	* The shared area as the leader's durable projection carries it: names,
	* attribution, and a one-line preview, never whole note bodies. A private
	* pad is never projected — private means private, including from the panel.
	* @param leaderId - the team's leader session id.
	* @returns the board index, newest first.
	*/
	async index(leaderId) {
		return (await this.read(leaderId, SHARED_AREA)).map((entry) => ({
			key: entry.key,
			authorId: entry.authorId,
			authorName: entry.authorName,
			updatedAt: entry.updatedAt,
			preview: previewOf(entry.text)
		}));
	}
	/** Release the domain handle; queued writes drain first. */
	dispose() {
		this.disposed = true;
		this.opening.then((domain) => domain.close(), () => void 0);
	}
};
//#endregion
//#region src/tools.ts
/** The acting agent; a team tool without one is a composition mistake. */
function actor(agent) {
	if (agent === void 0) throw new Error("team tools require an acting agent");
	return agent;
}
/** Pending-call card with the team treatment. */
function call(title, rawInput) {
	return {
		card: "generic",
		title,
		kind: "other",
		...rawInput !== void 0 ? { rawInput } : {}
	};
}
/** Completed-call card carrying one line of prose. */
function done(title, text) {
	return {
		card: "generic",
		title,
		...text !== void 0 ? { content: [{
			type: "text",
			text
		}] } : {}
	};
}
/** First text block of a failed result, for the failure card. */
function failureText(result) {
	const first = result.content[0];
	return first !== null && typeof first === "object" && first.type === "text" ? String(first.text ?? "failed") : "failed";
}
/** Member facts as one output value and one durable fact share them. */
const MEMBER_PROPERTIES = {
	memberId: {
		type: "string",
		required: true
	},
	name: {
		type: "string",
		required: true
	},
	role: { type: "string" },
	relation: {
		type: "string",
		required: true,
		enum: ["managed", "peer"]
	},
	model: { type: "string" },
	effort: { type: "string" }
};
/** Task facts as one output value and one durable fact share them. */
const TASK_PROPERTIES = {
	taskId: {
		type: "string",
		required: true
	},
	title: {
		type: "string",
		required: true
	},
	assigneeId: { type: "string" },
	status: {
		type: "string",
		required: true,
		enum: [
			"pending",
			"active",
			"done"
		]
	},
	note: { type: "string" }
};
/** Drop the undefined optional members a JSON fact must not carry. */
function memberValue(member) {
	return {
		memberId: member.memberId,
		name: member.name,
		relation: member.relation,
		...member.role !== void 0 ? { role: member.role } : {},
		...member.model !== void 0 ? { model: member.model } : {},
		...member.effort !== void 0 ? { effort: member.effort } : {}
	};
}
/**
* `team_spawn` — start a teammate. Leader-only: a teammate that could spawn
* would own a team its leader cannot see.
* @param ctx - context carrying the team service.
* @returns the tool definition.
*/
function spawnTool(ctx) {
	return defineTool({
		name: "team_spawn",
		description: "Add a teammate to your agent team. A teammate is a long-lived agent with its own session, its own memory and its own tools; it works in the background while you keep working, and it stays available until you dismiss it. Give it a name you will address it by and a first task. relation \"managed\" means it may only message you; \"peer\" means it may also message the other teammates directly and coordinate with them without going through you. Prefer a teammate over a one-shot subagent when the work needs several rounds, a durable owner, or someone the rest of the team can talk to. This is where a team begins: until one team_spawn has succeeded there is no team, no roster and no task list, and every other team_* tool has nothing to act on — call this one first.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Short display name you and the team will address it by, e.g. Alice."
			},
			task: {
				type: "string",
				required: true,
				description: "The first task, self-contained: the teammate does not see your conversation."
			},
			relation: {
				type: "string",
				required: true,
				enum: ["managed", "peer"],
				description: "managed: reports only to you. peer: may also message other teammates directly."
			},
			role: {
				type: "string",
				description: "Optional role, e.g. reviewer. Shown to the whole team."
			},
			persona: {
				type: "string",
				description: "Optional persona replacing the deployment persona for this teammate only."
			},
			model: {
				type: "string",
				description: "Optional model id; default inherits your own model."
			},
			reasoning_effort: {
				type: "string",
				description: "Optional provider-owned reasoning effort for this teammate, e.g. high. Rejected when the model does not offer it."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: MEMBER_PROPERTIES
			},
			render: (_args, value) => [{
				type: "text",
				text: `teammate ${value.name} joined as a ${value.relation} member and started on its task. Address it as "${value.name}" or "${value.memberId}".`
			}],
			presentationMeta: (_args, value) => ({
				team: "member-added",
				member: value
			})
		},
		presentCall: (args) => call(`Spawn teammate ${args.name}`, {
			relation: args.relation,
			...args.role !== void 0 ? { role: args.role } : {},
			...args.model !== void 0 ? { model: args.model } : {},
			task: args.task
		}),
		presentResult: (args, result) => result.isError ? done(`Spawn teammate ${args.name}`, `failed: ${failureText(result)}`) : done(`${args.name} joined the team`, args.role === void 0 ? args.relation : `${args.role} · ${args.relation}`),
		isConcurrencySafe: () => false,
		async execute(args, exec) {
			return memberValue(await ctx.team.spawn(actor(exec.agent), {
				name: args.name,
				task: args.task,
				relation: args.relation,
				...args.role !== void 0 ? { role: args.role } : {},
				...args.persona !== void 0 ? { persona: args.persona } : {},
				...args.model !== void 0 ? { model: args.model } : {},
				...args.reasoning_effort !== void 0 ? { reasoningEffort: args.reasoning_effort } : {}
			}, exec.signal));
		}
	});
}
/**
* `team_send` — the mailbox, shared by the leader and every teammate. The
* service decides what the caller's relation allows.
* @param ctx - context carrying the team service.
* @param audience - whose description this registration serves.
* @returns the tool definition.
*/
function sendTool(ctx, audience) {
	return defineTool({
		name: "team_send",
		description: audience === "leader" ? "Send a message to one teammate you have already spawned — with no team yet there is nobody to write to, so team_spawn comes first. It becomes that teammate's next turn: if it is busy, the message waits until the current turn ends, so it cannot redirect work already underway. Delivery is asynchronous — this returns once the message is accepted, never the teammate's answer; the reply arrives later as its own message to you." : "Send a message to another team member. Address the leader as \"leader\", or a teammate by its name. The message becomes the recipient's next turn; you get no answer back from this call. Use it to ask a peer for input, hand work over, or raise something with the leader mid-task. Finished work goes to the leader through team_send. A conversation between teammates carries a budget: it may only relay so far and you may not keep going back and forth with the same member about it, so ask for what you actually need in one message. Messaging the leader is never refused — when a peer exchange stops converging, that is the way out.",
		parameters: {
			to: {
				type: "string",
				required: true,
				description: "Recipient: a teammate name, a member id, or \"leader\"."
			},
			message: {
				type: "string",
				required: true,
				description: "Self-contained message; the recipient does not see your conversation."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					messageId: {
						type: "string",
						required: true
					},
					to: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					hop: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `message queued as the next turn of ${value.name}`
			}],
			presentationMeta: (args, value) => ({
				team: "message",
				messageId: value.messageId,
				to: value.to,
				text: args.message,
				hop: value.hop
			})
		},
		presentCall: (args) => call(`Message ${args.to}`, args.message),
		presentResult: (args, result) => result.isError ? done(`Message ${args.to}`, `not delivered: ${failureText(result)}`) : done(`Message sent to ${args.to}`),
		async execute(args, exec) {
			const sent = await ctx.team.send(actor(exec.agent), args.to, args.message, exec.signal);
			return {
				messageId: sent.messageId,
				to: sent.recipient.id,
				name: sent.recipient.name,
				hop: sent.chain.hop
			};
		}
	});
}
/**
* `team_task` — the shared task list. Writes are the leader's; teammates read
* it through `team_list` and send outcomes through `team_send`.
* @param ctx - context carrying the team service.
* @returns the tool definition.
*/
function taskTool(ctx) {
	return defineTool({
		name: "team_task",
		description: "Create or update one row of the shared team task list — the list every teammate can read, so it is where multi-teammate work is coordinated without routing every detail through messages. The list belongs to a live team, so spawn the teammates first: a row nobody is on the roster to read changes nothing, and assigning one to a name that is not on the roster is refused. Omit task_id to create a row (title required); pass task_id to update one. Assign with a teammate name or member id. A teammate closes its own row by sending the outcome to the leader, so you rarely set status yourself.",
		parameters: {
			title: {
				type: "string",
				description: "Task title; required when creating."
			},
			assignee: {
				type: "string",
				description: "Teammate name or member id; omit to leave the task unassigned."
			},
			task_id: {
				type: "string",
				description: "Existing task id to update; omit to create a new task."
			},
			status: {
				type: "string",
				enum: [
					"pending",
					"active",
					"done"
				],
				description: "Task state; defaults to pending on creation."
			},
			note: {
				type: "string",
				description: "Short note recorded with the task, e.g. why it was closed."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: TASK_PROPERTIES
			},
			render: (_args, value) => [{
				type: "text",
				text: `task ${value.taskId} "${value.title}" is ${value.status}` + (value.assigneeId === void 0 ? " and unassigned" : ` for ${value.assigneeId}`)
			}],
			presentationMeta: (_args, value) => ({
				team: "task",
				task: value
			})
		},
		presentCall: (args) => call(args.task_id === void 0 ? `New task: ${args.title ?? ""}` : `Update task ${args.task_id}`, {
			...args.assignee !== void 0 ? { assignee: args.assignee } : {},
			...args.status !== void 0 ? { status: args.status } : {}
		}),
		presentResult: (args, result) => result.isError ? done("Team task", `failed: ${failureText(result)}`) : done(args.task_id === void 0 ? `Task added: ${args.title ?? ""}` : `Task ${args.task_id} updated`),
		isConcurrencySafe: () => false,
		execute(args, exec) {
			const task = ctx.team.upsertTask(actor(exec.agent), {
				...args.task_id !== void 0 ? { taskId: args.task_id } : {},
				...args.title !== void 0 ? { title: args.title } : {},
				...args.assignee !== void 0 ? { assigneeId: args.assignee } : {},
				...args.status !== void 0 ? { status: args.status } : {},
				...args.note !== void 0 ? { note: args.note } : {}
			});
			return Promise.resolve({
				taskId: task.taskId,
				title: task.title,
				status: task.status,
				...task.assigneeId !== void 0 ? { assigneeId: task.assigneeId } : {},
				...task.note !== void 0 ? { note: task.note } : {}
			});
		}
	});
}
/**
* `team_relation` — widen or tighten one teammate's autonomy.
* @param ctx - context carrying the team service.
* @returns the tool definition.
*/
function relationTool(ctx) {
	return defineTool({
		name: "team_relation",
		description: "Change how much one teammate may talk to the rest of the team; the teammate must already be on the roster, so this never applies before you have spawned one. \"peer\" lets it message other teammates directly and self-coordinate; \"managed\" routes all of its traffic back through you. Widen when a teammate needs to work with another one; tighten when you want every hand-off to pass your desk.",
		parameters: {
			member: {
				type: "string",
				required: true,
				description: "Teammate name or member id."
			},
			relation: {
				type: "string",
				required: true,
				enum: ["managed", "peer"],
				description: "The new relation."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: MEMBER_PROPERTIES
			},
			render: (_args, value) => [{
				type: "text",
				text: `${value.name} is now a ${value.relation} member`
			}],
			presentationMeta: (_args, value) => ({
				team: "member-updated",
				member: value
			})
		},
		presentCall: (args) => call(`Set ${args.member} to ${args.relation}`),
		presentResult: (args, result) => result.isError ? done(`Set ${args.member} to ${args.relation}`, `failed: ${failureText(result)}`) : done(`${args.member} is now ${args.relation}`),
		isConcurrencySafe: () => false,
		execute(args, exec) {
			return Promise.resolve(memberValue(ctx.team.setRelation(actor(exec.agent), args.member, args.relation)));
		}
	});
}
/**
* `team_dismiss` — release one teammate, or the whole team.
* @param ctx - context carrying the team service.
* @returns the tool definition.
*/
function dismissTool(ctx) {
	return defineTool({
		name: "team_dismiss",
		description: "Dismiss one teammate, or the whole team when you name nobody — there is nothing to dismiss until you have spawned someone. A dismissed teammate stops what it is doing and receives no further messages; its transcript stays readable. Dismiss teammates whose work is finished — an idle teammate costs nothing to keep, but a stale one invites you to message it again.",
		parameters: { member: {
			type: "string",
			description: "Teammate name or member id; omit to dismiss the whole team."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ended: {
						type: "boolean",
						required: true
					},
					memberId: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.ended ? "the team is disbanded" : `teammate ${String(value.memberId)} is dismissed`
			}],
			presentationMeta: (_args, value) => value.ended ? { team: "ended" } : {
				team: "member-removed",
				memberId: String(value.memberId)
			}
		},
		presentCall: (args) => call(args.member === void 0 ? "Disband the team" : `Dismiss ${args.member}`),
		presentResult: (args, result) => result.isError ? done("Dismiss", `failed: ${failureText(result)}`) : done(args.member === void 0 ? "Team disbanded" : `${args.member} dismissed`),
		isConcurrencySafe: () => false,
		execute(args, exec) {
			return Promise.resolve(ctx.team.dismiss(actor(exec.agent), args.member));
		}
	});
}
/**
* `team_list` — the shared read every member uses to decide who to talk to.
* @param ctx - context carrying the team service.
* @param audience - whose reading of an empty team this registration serves.
* @returns the tool definition.
*/
function listTool(ctx, audience = "leader") {
	return defineTool({
		name: "team_list",
		description: audience === "leader" ? "Read your team: every member with its role, relation and live state (running, idle, or ready to wake), the shared task list, and the recent mailbox traffic. Use it before messaging or assigning work, and to check whether a teammate is still busy. It reads a team you built yourself — before your first team_spawn it reports an empty team, so do not call it to find out whether you have one." : "Read the team: every member with its role, relation and live state (running, idle, or ready to wake), the shared task list, and the recent mailbox traffic the leader can see. Use it before messaging or assigning work, and to check whether a teammate is still busy.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					active: {
						type: "boolean",
						required: true
					},
					members: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								...MEMBER_PROPERTIES,
								status: {
									type: "string",
									required: true,
									enum: [
										"running",
										"idle",
										"ready"
									]
								}
							}
						}
					},
					tasks: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: TASK_PROPERTIES
						}
					},
					messages: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								from: {
									type: "string",
									required: true
								},
								to: {
									type: "string",
									required: true
								},
								text: {
									type: "string",
									required: true
								},
								hop: { type: "number" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.active ? `${value.members.length} teammate(s), ${value.tasks.filter((task) => task.status !== "done").length} open task(s)` : audience === "leader" ? "no team yet — team_spawn starts one" : "the team is not readable from here right now; its main session is not loaded"
			}]
		},
		presentCall: () => ({
			card: "generic",
			title: "Read the team",
			kind: "read"
		}),
		presentResult: (_args, result) => result.isError ? done("Read the team", "failed") : done("Team state"),
		execute(_args, exec) {
			const team = ctx.team.list(actor(exec.agent));
			return Promise.resolve({
				active: team.active,
				members: team.members.map((member) => ({
					...memberValue(member),
					status: member.status
				})),
				tasks: team.tasks.map((task) => ({
					taskId: task.taskId,
					title: task.title,
					status: task.status,
					...task.assigneeId !== void 0 ? { assigneeId: task.assigneeId } : {},
					...task.note !== void 0 ? { note: task.note } : {}
				})),
				messages: team.messages.map((message) => ({
					from: message.from ?? "leader",
					to: message.to ?? "leader",
					text: message.text,
					...message.hop !== void 0 ? { hop: message.hop } : {}
				}))
			});
		}
	});
}
/** The notes one `team_board` read returns for a named key. */
function pickNote(held, key) {
	const wanted = key.trim();
	return held.filter((entry) => entry.key === wanted);
}
/** Board entry facts as one output value and one durable fact share them. */
const BOARD_PROPERTIES = {
	key: {
		type: "string",
		required: true
	},
	authorId: {
		type: "string",
		required: true
	},
	authorName: {
		type: "string",
		required: true
	},
	updatedAt: {
		type: "number",
		required: true
	},
	preview: {
		type: "string",
		required: true
	}
};
/** The team's workspace, the area, and the signature one call addresses. */
function place(seat, priv) {
	return {
		leaderId: seat.leaderId,
		area: priv ? seat.memberId : SHARED_AREA,
		author: {
			id: seat.memberId,
			name: seat.name
		}
	};
}
/**
* `team_note` — write or drop one note in a virtual workspace.
* @param workspace - the open workspace domain.
* @param audience - whose description this registration serves.
* @param seatOf - where the caller sits (see {@link SeatResolver}).
* @returns the tool definition.
*/
function noteTool(workspace, audience, seatOf) {
	return defineTool({
		name: "team_note",
		description: "Write one note into a team workspace. These workspaces are the team's own — they are NOT files and they are not in the user's working tree. " + (audience === "leader" ? "Every teammate reads and writes the shared board, so it is where a decision belongs once you have made it — leaving a note costs no turn, while messaging someone costs one of theirs. It is worth writing to once you have teammates: before your first team_spawn nobody is there to read it." : "Every member reads and writes the shared board. Put a conclusion there instead of messaging it around: a note costs nobody a turn, and it is still there after you have finished and gone idle.") + " With private=true the note goes to your own pad instead, which nobody else can read: use it to keep your own state across turns. Writing a key that already exists replaces it whole; omit text to drop the note.",
		parameters: {
			key: {
				type: "string",
				required: true,
				description: "Short name of the note, e.g. \"api decision\". Writing the same key again replaces it."
			},
			text: {
				type: "string",
				description: "The whole note. Omit to delete the note instead."
			},
			private: {
				type: "boolean",
				description: "true writes your own private pad; default false writes the shared board."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					key: {
						type: "string",
						required: true
					},
					area: {
						type: "string",
						required: true,
						enum: ["shared", "private"]
					},
					removed: {
						type: "boolean",
						required: true
					},
					board: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: BOARD_PROPERTIES
						}
					},
					at: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.removed ? `dropped "${value.key}" from the ${value.area} workspace` : `wrote "${value.key}" to the ${value.area} workspace`
			}],
			presentationMeta: (_args, value) => ({
				team: "board",
				entries: value.board,
				at: value.at
			})
		},
		presentCall: (args) => call(args.text === void 0 ? `Drop note ${args.key}` : `Note: ${args.key}`, args.private === true ? { private: true } : void 0),
		presentResult: (args, result) => result.isError ? done(`Note: ${args.key}`, `failed: ${failureText(result)}`) : done(args.text === void 0 ? `Dropped ${args.key}` : `Noted ${args.key}`, args.private === true ? "private" : "shared"),
		isConcurrencySafe: () => false,
		async execute(args, exec) {
			const spot = place(seatOf(actor(exec.agent)), args.private === true);
			const now = Date.now();
			if (args.text === void 0) await workspace.remove(spot.leaderId, spot.area, args.key);
			else await workspace.write(spot.leaderId, spot.area, args.key, args.text, spot.author, now);
			return {
				key: args.key.trim(),
				area: args.private === true ? "private" : "shared",
				removed: args.text === void 0,
				board: [...await workspace.index(spot.leaderId)],
				at: now
			};
		}
	});
}
/**
* `team_board` — read a virtual workspace.
* @param workspace - the open workspace domain.
* @param audience - whose description this registration serves.
* @param seatOf - where the caller sits (see {@link SeatResolver}).
* @returns the tool definition.
*/
function boardTool(workspace, audience, seatOf) {
	return defineTool({
		name: "team_board",
		description: "Read a team workspace: the shared board every member writes to, or your own private pad. Without a key you get the index — every note with who wrote it and when — and with a key you get that note in full. " + (audience === "leader" ? "Read the board before assigning work: a teammate that has already recorded its conclusion there does not need to be asked for it again. The board belongs to the team, so before your first team_spawn it is empty and reading it tells you nothing." : "Read the board before messaging anyone: what you were about to ask for may already be written down, and a note costs nobody a turn."),
		parameters: {
			key: {
				type: "string",
				description: "Read one note in full; omit for the index of the whole area."
			},
			private: {
				type: "boolean",
				description: "true reads your own private pad; default false reads the shared board."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					area: {
						type: "string",
						required: true,
						enum: ["shared", "private"]
					},
					entries: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								...BOARD_PROPERTIES,
								text: { type: "string" }
							}
						}
					},
					board: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: BOARD_PROPERTIES
						}
					},
					at: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.entries.length === 0 ? `the ${value.area} workspace is empty` : value.entries.map((entry) => `## ${entry.key} — ${entry.authorName}\n${entry.text ?? entry.preview}`).join("\n\n")
			}],
			presentationMeta: (_args, value) => ({
				team: "board",
				entries: value.board,
				at: value.at
			})
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.key === void 0 ? "Read the team workspace" : `Read note ${args.key}`,
			kind: "read"
		}),
		presentResult: (_args, result) => result.isError ? done("Read the team workspace", "failed") : done("Team workspace"),
		async execute(args, exec) {
			const spot = place(seatOf(actor(exec.agent)), args.private === true);
			const held = await workspace.read(spot.leaderId, spot.area);
			const wanted = args.key === void 0 ? held : pickNote(held, args.key);
			return {
				area: args.private === true ? "private" : "shared",
				entries: wanted.map((entry) => ({
					key: entry.key,
					authorId: entry.authorId,
					authorName: entry.authorName,
					updatedAt: entry.updatedAt,
					preview: entry.text.split("\n")[0] ?? "",
					text: entry.text
				})),
				board: [...await workspace.index(spot.leaderId)],
				at: Date.now()
			};
		}
	});
}
//#endregion
//#region src/teammate.ts
/** Guidance order: after the harness tool sections, before the persona. */
const TEAM_SECTION_ORDER = 118;
/** The workspace paragraph sits right after the membership briefing. */
const WORKSPACE_SECTION_ORDER = 119;
/** What a teammate needs to know about the two workspaces it can reach. */
const WORKSPACE_BRIEFING = [
	"Your team has two virtual workspaces, which are not files and are not in the user's working tree.",
	"The shared board (team_board / team_note) is what every member reads and writes: put a conclusion, a decision or hand-off material there instead of messaging it around — a note costs nobody a turn and survives after you go idle, while a message costs the recipient a turn and spends conversation budget. Read the board before you ask anyone anything; the answer may already be on it.",
	"Your private pad (the same tools with private=true) is yours alone: keep your own working state there so a later turn of yours can pick it up."
].join("\n");
/** Dispose a batch completely, then report the first failure. */
function release(disposers) {
	const failures = [];
	for (const dispose of [...disposers].reverse()) try {
		dispose();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "dsh-team: teammate teardown failed");
}
/** Observe the live agent registry so cold resumes and fresh children share one setup path. */
function registerChildSetup(ctx, setup) {
	const installed = /* @__PURE__ */ new Map();
	const install = (agent) => {
		if (agent.session.header.origin !== "subagent" || installed.has(agent.id)) return;
		const dispose = setup(agent.ctx);
		installed.set(agent.id, dispose);
	};
	const disposeCreated = ctx.on("agent/created", (payload) => {
		install(payload.agent);
	});
	const disposeRemoved = ctx.on("agent/disposed", (payload) => {
		const dispose = installed.get(payload.agent.id);
		installed.delete(payload.agent.id);
		dispose?.();
	});
	for (const agent of ctx.agents.list()) install(agent);
	return () => {
		disposeRemoved();
		disposeCreated();
		for (const dispose of installed.values()) dispose();
		installed.clear();
	};
}
/** One roster line as a teammate reads it. */
function memberLine(member) {
	const parts = [member.role, member.relation === "peer" ? "peer" : "managed"].filter((part) => part !== void 0);
	return `${member.name} (${parts.join(", ")})`;
}
/**
* What a teammate is told when its roster row cannot be read. Two different
* facts wear that one absence, and they ask for opposite things: a leader
* session that is merely not loaded still has a team behind it, so the work is
* worth finishing and parking on the shared board; a team that let this member
* go has nobody left to read anything.
*/
function orphaned(ctx, child) {
	const leaderId = child.session.header.parentSession;
	if (leaderId !== void 0 && ctx.agents.get(leaderId) === void 0) return "Your team is intact, but its main session is not loaded right now, so team_send has nowhere to deliver. Your work is not lost: finish what you were asked for, write the result to the shared workspace with team_note if you have one, and stop — the leader reads it when it comes back.";
	return "You were part of an agent team that is no longer active: nothing you send can be delivered and nobody is waiting on you. Report what you already have and stop.";
}
/**
* The teammate's standing briefing, re-rendered at every assembly so a member
* that joins later, a promotion, or a new task is visible on the next step
* without touching the child's own log.
*/
function briefing(ctx, team, child) {
	const roster = team.rosterFor(child);
	if (roster === void 0) return orphaned(ctx, child);
	const { self, others } = roster;
	const identity = self.role === void 0 ? `You are ${self.name}, a teammate on an agent team.` : `You are ${self.name}, the ${self.role} on an agent team.`;
	const reach = self.relation === "peer" ? "You are a peer member: team_send reaches the leader (\"leader\") and any teammate by name." : "You are a managed member: team_send reaches the leader (\"leader\") only.";
	const list = others.length === 0 ? "You are currently the only teammate." : `The rest of the team: ${others.map(memberLine).join("; ")}.`;
	const mine = team.list(child).tasks.filter((task) => task.assigneeId === self.memberId && task.status !== "done");
	return [
		identity,
		reach,
		list,
		mine.length === 0 ? "No task on the shared list is assigned to you right now." : `Assigned to you on the shared task list: ${mine.map((task) => `${task.taskId} "${task.title}"`).join("; ")}.`,
		"Nobody sees your session but you, so deliver results to the leader with team_send — a self-contained answer, not \"done\". Use team_send when you need something FROM a member mid-task; the reply arrives later as its own turn, so do not wait for it in place. team_list shows the roster, the shared task list, and recent traffic. When you have sent the outcome, stop and wait for the next message instead of starting work nobody asked for. A conversation between teammates is budgeted: it may only relay so far and one pair may not keep trading messages inside it, so put everything you need into one message rather than negotiating. Reaching the leader is never refused — when an exchange with a peer stops converging, say so to the leader and move on."
	].join("\n");
}
/**
* Register the teammate composition for every continuable child of a team.
* @param ctx - context carrying the team and subagent services.
* @returns the exact effect disposer removing the contribution.
*/
function installTeammateWorld(ctx) {
	return registerChildSetup(ctx, (childCtx) => {
		const child = childCtx.agent;
		if (child === void 0) return () => {};
		if (ctx.team.adopt(child) === void 0) return () => {};
		const disposers = [];
		try {
			disposers.push(childCtx.systemPrompt.section({
				name: "team-membership",
				order: TEAM_SECTION_ORDER,
				text: () => briefing(ctx, ctx.team, child)
			}));
			disposers.push(childCtx.tools.register(sendTool(ctx, "member")));
			disposers.push(childCtx.tools.register(listTool(ctx, "member")));
		} catch (error) {
			release(disposers);
			throw error;
		}
		return () => {
			release(disposers);
		};
	});
}
/**
* Give every teammate its half of the virtual workspaces: the shared board it
* writes conclusions to, and its own private pad. Registered separately from
* {@link installTeammateWorld} because the workspaces are optional — a
* deployment without a storage domain form composes this contribution out and
* the rest of the teammate world is untouched.
* @param ctx - context carrying the team service and the open workspace.
* @param workspace - the open workspace domain.
* @returns the exact effect disposer removing the contribution.
*/
function installTeammateWorkspace(ctx, workspace) {
	return registerChildSetup(ctx, (childCtx) => {
		const child = childCtx.agent;
		const leaderId = child?.session.header.parentSession;
		const roster = child === void 0 ? void 0 : ctx.team.rosterFor(child);
		if (child === void 0 || leaderId === void 0 || roster === void 0) return () => {};
		const seat = {
			leaderId,
			memberId: child.id,
			name: roster.self.name
		};
		const seatOf = () => seat;
		const disposers = [];
		try {
			disposers.push(childCtx.systemPrompt.section({
				name: "team-workspace",
				order: WORKSPACE_SECTION_ORDER,
				text: WORKSPACE_BRIEFING
			}));
			disposers.push(childCtx.tools.register(noteTool(workspace, "member", seatOf)));
			disposers.push(childCtx.tools.register(boardTool(workspace, "member", seatOf)));
		} catch (error) {
			release(disposers);
			throw error;
		}
		return () => {
			release(disposers);
		};
	});
}
//#endregion
//#region src/index.ts
const name = "team";
/**
* `tools` and `systemPrompt` are declared although this row registers into
* agent scopes rather than the root registry: a Loader ordering mistake then
* fails at load instead of at the next session or teammate.
*/
const inject = [
	"agents",
	"subagents",
	"sessionProjections",
	"tools",
	"systemPrompt"
];
/** A team leader is any ordinary session; a teammate never leads its own team. */
function leads(agent) {
	return agent.session.header.origin !== "subagent";
}
/**
* Install the leader tool set into one session's own agent scope, so an
* ordinary subagent — which inherits the global registry but not this scope —
* never sees tools that would fail for it.
* @param ctx - context carrying the team service.
* @param agent - the session agent to equip.
* @returns the disposer for every registration made here.
*/
function installLeaderTools(ctx, agent) {
	const disposers = [
		agent.ctx.tools.register(spawnTool(ctx)),
		agent.ctx.tools.register(sendTool(ctx, "leader")),
		agent.ctx.tools.register(taskTool(ctx)),
		agent.ctx.tools.register(relationTool(ctx)),
		agent.ctx.tools.register(dismissTool(ctx)),
		agent.ctx.tools.register(listTool(ctx))
	];
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
/**
* Equip every leader session, now and as sessions arrive, with one tool set.
* @param ctx - the context owning the registrations.
* @param install - what to register into one leader's own agent scope.
* @returns the disposer taking the tools off every session that outlives it.
*/
function equipLeaders(ctx, install) {
	const equipped = /* @__PURE__ */ new Map();
	const equip = (agent) => {
		if (!leads(agent) || equipped.has(agent.id)) return;
		equipped.set(agent.id, install(agent));
	};
	ctx.on("agent/created", (payload) => {
		equip(payload.agent);
	});
	ctx.on("agent/disposed", (payload) => {
		equipped.delete(payload.agent.id);
	});
	for (const agent of ctx.agents.list()) equip(agent);
	return () => {
		for (const dispose of equipped.values()) dispose();
		equipped.clear();
	};
}
/**
* The virtual workspaces, when the deployment composed a storage domain form.
* Without one the team keeps everything else and the workspace tools are never
* registered — no member sees a tool that has nowhere to write.
* @param ctx - a context whose `team` service is resolved.
* @param config - the validated row configuration.
*/
function installWorkspaces(ctx, config) {
	ctx.inject(["storageDomain"], (workspaceCtx) => {
		const workspace = new TeamWorkspace(workspaceCtx, config);
		workspaceCtx.effect(() => () => {
			workspace.dispose();
		}, "team: workspace domain");
		workspaceCtx.on("team/changed", (payload) => {
			if (payload.ended === true) workspace.clear(payload.leaderId);
			else if (payload.removedMember !== void 0) workspace.clear(payload.leaderId, payload.removedMember);
		});
		workspaceCtx.effect(() => equipLeaders(workspaceCtx, (agent) => {
			const disposers = [agent.ctx.tools.register(noteTool(workspace, "leader", (actor) => workspaceCtx.team.seatOf(actor))), agent.ctx.tools.register(boardTool(workspace, "leader", (actor) => workspaceCtx.team.seatOf(actor)))];
			return () => {
				for (const dispose of disposers.reverse()) dispose();
			};
		}), "team: leader workspace tools");
		workspaceCtx.effect(() => installTeammateWorkspace(workspaceCtx, workspace), "team: teammate workspace tools");
	});
}
/**
* Compose the team capability: the service, the durable projection unit, the
* teammate world, the per-session leader tools, the virtual workspaces, and
* the human `/agent-teams` command.
*
* `commands` is injected softly rather than declared on the row, like
* `storageDomain`: UI-less compositions ship no command adapter, and the row
* must load there with every other capability intact.
*
* @param ctx - the row's context.
* @param config - the validated row configuration.
*/
function apply(ctx, config) {
	ctx.plugin(TeamService, config);
	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.effect(() => installCommand(commandCtx), "team: /agent-teams command");
	});
	ctx.inject(["team"], (teamCtx) => {
		teamCtx.effect(() => teamCtx.sessionProjections.register(teamProjection(config.maxRecentMessages)), "team: durable projection unit");
		teamCtx.effect(() => installTeammateWorld(teamCtx), "team: teammate world");
		teamCtx.effect(() => equipLeaders(teamCtx, (agent) => installLeaderTools(teamCtx, agent)), "team: leader tools");
		installWorkspaces(teamCtx, config);
	});
}
//#endregion
export { Config, EMPTY_TEAM_VIEW, SHARED_AREA, TEAM_PROJECTION_KEY, TeamError, TeamService, TeamWorkspace, WORKSPACE_DOMAIN, apply, foldTeam, inject, name, teamProjection };
