// Emerald Lost Generation: Friend Portal
// Static single-page app. All access control lives in the database (RLS);
// this file only decides what to show.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SPECIES } from "./species.js";

const SUPABASE_URL = "https://ejworaccnktuzlevzydn.supabase.co";
const SUPABASE_KEY = "sb_publishable_Xm5oe0vRFaizEggFh_gFEQ_a1p5TdYe"; // public by design
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const TYPES = ["Normal","Fire","Water","Grass","Electric","Ice","Fighting","Poison","Ground",
  "Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"];
const app = document.getElementById("app");
const state = { user: null, profile: null };

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
function fail(error, fallback) {
  const msg = error?.message || fallback || "Something went wrong";
  if (/claims_one_per_type/.test(msg)) return toast("Someone already claimed that type.", true);
  if (/claims_one_per_slot/.test(msg)) return toast("That slot was just taken.", true);
  if (/claims_one_per_user/.test(msg)) return toast("You already have a claim. Drop it first.", true);
  toast(msg, true);
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function passwordProblem(pw) {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letters and numbers.";
  return null;
}
function typeChip(t) { return t ? `<span class="type-chip" data-type="${esc(t)}">${esc(t)}</span>` : ""; }
function names(profiles) { return Object.fromEntries((profiles || []).map(p => [p.id, p.display_name || "Someone"])); }

// ---------- theme ----------
function applyThemeLabel() {
  const dark = document.documentElement.dataset.theme !== "light";
  for (const id of ["theme-toggle", "theme-toggle-auth"]) {
    const b = document.getElementById(id);
    b.textContent = dark ? "Light mode" : "Dark mode";
  }
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("elg-theme", next); } catch (e) {}
  applyThemeLabel();
}
document.getElementById("theme-toggle").onclick = toggleTheme;
document.getElementById("theme-toggle-auth").onclick = toggleTheme;
applyThemeLabel();

// ---------- shell ----------
function showShell(signedIn) {
  document.getElementById("header").hidden = !signedIn;
  document.getElementById("theme-toggle-auth").hidden = signedIn;
  document.getElementById("nav-admin").hidden = !state.profile?.is_admin;
}
document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); location.hash = ""; };

async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", state.user.id).single();
  if (error) { fail(error); return null; }
  return data;
}

// ---------- auth views ----------
function viewLogin() {
  showShell(false);
  app.innerHTML = `
  <div class="auth-wrap"><div class="auth-card card stack">
    <h1 class="page-title">Emerald Lost Generation</h1>
    <p class="muted">Members only. Abner sends your login on WhatsApp.</p>
    <form id="login" class="stack">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary" type="submit">Log in</button>
    </form>
    <button class="btn btn-ghost btn-small" id="forgot" type="button">Forgot password? Email me a link</button>
    <p class="hint">No email after a few minutes? Message Abner and he’ll reset it.</p>
  </div></div>`;
  document.getElementById("login").onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("pw").value,
    });
    btn.disabled = false;
    if (error) fail(error, "Wrong email or password");
  };
  document.getElementById("forgot").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    if (!email) return toast("Type your email first.", true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "#/reset" });
    if (error) return fail(error);
    toast("If that account exists, a link is on its way.");
  };
}

function viewSetPassword(firstTime) {
  showShell(false);
  app.innerHTML = `
  <div class="auth-wrap"><div class="auth-card card stack">
    <h1 class="page-title">${firstTime ? "Welcome to the crew" : "Set a new password"}</h1>
    <p class="muted">${firstTime ? "Pick your own password and the name the group will see." : "Choose a new password."}</p>
    <form id="setpw" class="stack">
      ${firstTime ? `<div class="field"><label for="dname">Display name</label><input id="dname" maxlength="24" required value="${esc(state.profile?.display_name)}"></div>` : ""}
      <div class="field"><label for="pw1">New password</label><input id="pw1" type="password" autocomplete="new-password" required>
        <p class="hint">At least 10 characters, letters and numbers.</p></div>
      <div class="field"><label for="pw2">Repeat it</label><input id="pw2" type="password" autocomplete="new-password" required></div>
      <p class="error-text" id="pwerr"></p>
      <button class="btn btn-primary" type="submit">Save</button>
    </form>
  </div></div>`;
  document.getElementById("setpw").onsubmit = async e => {
    e.preventDefault();
    const pw = document.getElementById("pw1").value, err = document.getElementById("pwerr");
    if (pw !== document.getElementById("pw2").value) return (err.textContent = "Passwords don’t match.");
    const problem = passwordProblem(pw); if (problem) return (err.textContent = problem);
    err.textContent = "";
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return fail(error);
    const patch = { must_change_password: false };
    if (firstTime) patch.display_name = document.getElementById("dname").value.trim();
    const { error: e2 } = await sb.from("profiles").update(patch).eq("id", state.user.id);
    if (e2) return fail(e2);
    state.profile = { ...state.profile, ...patch };
    toast("Password saved.");
    location.hash = "#/home"; route();
  };
}

// ---------- home ----------
async function viewHome() {
  const [{ data: updates }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("updates").select("*").order("created_at", { ascending: false }),
    sb.from("claims").select("role_id,user_id,poke_type,status").neq("status", "rejected"),
    sb.from("roles").select("id,label,claimable"),
  ]);
  const mine = (claims || []).find(c => c.user_id === state.user.id);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const claimable = (roles || []).filter(r => r.claimable).length;
  app.innerHTML = `
  <h1 class="page-title">Hey ${esc(state.profile.display_name)}!</h1>
  <div class="grid">
    <div class="card stack"><h2 class="card-title">Your role</h2>
      ${mine ? `<p>${esc(roleLabel[mine.role_id])} ${typeChip(mine.poke_type)} <span class="badge badge-${mine.status}">${mine.status}</span></p>`
             : `<p class="muted">No role yet.</p><a class="btn btn-gold" href="#/roles">Pick a role</a>`}
    </div>
    <div class="card stack"><h2 class="card-title">The crew</h2>
      <p><b>${(claims || []).length}</b> of ${claimable} slots claimed.</p>
      <a class="btn btn-ghost btn-small" href="#/roles">See who’s who</a>
    </div>
  </div>
  <h2 class="page-title">Game progress</h2>
  <div class="stack">
    ${(updates || []).map(u => `
      <article class="update card">
        ${u.milestone ? `<span class="milestone">${esc(u.milestone)}</span>` : ""}
        <h3 class="card-title">${esc(u.title)}</h3>
        <p class="post-meta">${fmtDate(u.created_at)}</p>
        <p class="post-body">${esc(u.body)}</p>
      </article>`).join("") || `<p class="muted">No updates yet. Abner will post progress here.</p>`}
  </div>`;
}

// ---------- roles ----------
async function viewRoles() {
  const [{ data: roles }, { data: claims }, { data: profiles }] = await Promise.all([
    sb.from("roles").select("*").order("sort"),
    sb.from("claims").select("*").neq("status", "rejected"),
    sb.from("profiles").select("id,display_name"),
  ]);
  const who = names(profiles);
  const bySlot = Object.fromEntries((claims || []).map(c => [c.role_id, c]));
  const mine = (claims || []).find(c => c.user_id === state.user.id);
  const takenTypes = new Set((claims || []).map(c => c.poke_type).filter(Boolean));
  const freeTypes = TYPES.filter(t => !takenTypes.has(t));

  const slotHtml = r => {
    const c = bySlot[r.id];
    let body;
    if (!r.claimable && !c) body = `<span class="badge badge-reserved">Reserved</span><p class="muted">Abner decides this one.</p>`;
    else if (c) body = `<p class="slot-holder">${esc(who[c.user_id])} ${typeChip(c.poke_type)}</p>
        <span class="badge badge-${c.status}">${c.status === "approved" ? "Taken" : "Pending"}</span>
        ${c.user_id === state.user.id && c.status === "pending" ? `<button class="btn btn-ghost btn-small" data-drop="${c.id}">Drop claim</button>` : ""}`;
    else if (mine) body = `<span class="badge badge-open">Open</span>`;
    else body = `<span class="badge badge-open">Open</span>
        <div class="row">
          ${r.needs_type ? `<select data-type-for="${r.id}" aria-label="Type for ${esc(r.label)}">
             <option value="">Pick a type…</option>${freeTypes.map(t => `<option>${t}</option>`).join("")}</select>` : ""}
          <button class="btn btn-gold btn-small" data-claim="${r.id}">Claim</button>
        </div>`;
    const cls = ["slot", "card", c?.user_id === state.user.id ? "is-mine" : "", !r.claimable && !c ? "is-reserved" : ""].join(" ");
    return `<div class="${cls}"><div class="slot-head"><h3 class="card-title">${esc(r.label)}</h3></div>${body}</div>`;
  };
  const group = (title, cats) => `<h2 class="page-title">${title}</h2><div class="grid">${(roles || []).filter(r => cats.includes(r.category)).map(slotHtml).join("")}</div>`;
  app.innerHTML = `
    <h1 class="page-title">Roles</h1>
    <p class="muted">${mine ? "You’ve claimed your slot. Abner approves claims." : "Claim one slot. Gym Leaders and the Elite Four each pick a type nobody else has."}</p>
    ${group("Gym Leaders", ["gym"])}
    ${group("Elite Four & Champion", ["elite4", "champion"])}
    ${group("Villains & Professor", ["aqua", "magma", "professor"])}`;

  app.querySelectorAll("[data-claim]").forEach(b => b.onclick = async () => {
    const roleId = b.dataset.claim;
    const sel = app.querySelector(`[data-type-for="${roleId}"]`);
    if (sel && !sel.value) return toast("Pick a type first.", true);
    b.disabled = true;
    const { error } = await sb.from("claims").insert({ role_id: roleId, poke_type: sel ? sel.value : null });
    if (error) { b.disabled = false; return fail(error); }
    toast("Claimed! Waiting for Abner’s approval.");
    viewRoles();
  });
  app.querySelectorAll("[data-drop]").forEach(b => b.onclick = async () => {
    if (!confirm("Drop your claim?")) return;
    const { error } = await sb.from("claims").delete().eq("id", b.dataset.drop);
    if (error) return fail(error);
    toast("Claim dropped."); viewRoles();
  });
}

// ---------- my character ----------
async function signedLook(path) {
  if (!path) return null;
  const { data } = await sb.storage.from("looks").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}
async function viewMe() {
  const { data: ch } = await sb.from("characters").select("*").eq("user_id", state.user.id).maybeSingle();
  const c = ch || { character_name: "", team: [], look_note: "", look_image: null, dialogue: {}, notes: "" };
  const team = Array.from({ length: 6 }, (_, i) => c.team[i] || { species: "", nickname: "", note: "" });
  const d = c.dialogue || {};
  const lookUrl = await signedLook(c.look_image);
  app.innerHTML = `
  <h1 class="page-title">My Character</h1>
  <p class="muted">Only you and Abner can see this page’s answers.</p>
  <form id="char" class="stack">
    <div class="card stack"><h2 class="card-title">Who are you in the game?</h2>
      <div class="field"><label for="cname">Character name</label><input id="cname" maxlength="12" value="${esc(c.character_name)}">
        <p class="hint">GBA names fit 12 characters.</p></div>
    </div>
    <div class="card stack"><h2 class="card-title">Your team (up to 6)</h2>
      <datalist id="species">${SPECIES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <div class="team-grid">
        ${team.map((m, i) => `<div class="team-slot stack">
          <div class="field"><label for="sp${i}">Pokémon ${i + 1}</label><input id="sp${i}" list="species" value="${esc(m.species)}" autocomplete="off"></div>
          <div class="field"><label for="nn${i}">Nickname</label><input id="nn${i}" maxlength="12" value="${esc(m.nickname)}"></div>
          <div class="field"><label for="no${i}">Note (moves, item…)</label><input id="no${i}" maxlength="120" value="${esc(m.note)}"></div>
        </div>`).join("")}
      </div>
    </div>
    <div class="card stack"><h2 class="card-title">Your look</h2>
      <div class="look-preview">${lookUrl ? `<img src="${esc(lookUrl)}" alt="Your look reference">` : `<p class="muted">No image yet.</p>`}</div>
      <div class="field"><label for="lookfile">Reference image (PNG, JPG or WebP, max 5 MB)</label><input id="lookfile" type="file" accept="image/png,image/jpeg,image/webp"></div>
      <div class="field"><label for="looknote">Describe it</label><textarea id="looknote" rows="3" maxlength="600">${esc(c.look_note)}</textarea></div>
    </div>
    <div class="card stack"><h2 class="card-title">What you say</h2>
      <div class="field"><label for="dintro">Before the battle</label><textarea id="dintro" rows="2" maxlength="300">${esc(d.intro)}</textarea></div>
      <div class="field"><label for="ddefeat">When you lose</label><textarea id="ddefeat" rows="2" maxlength="300">${esc(d.defeat)}</textarea></div>
      <div class="field"><label for="dextra">Extra lines (one per line)</label><textarea id="dextra" rows="3" maxlength="800">${esc((d.extra || []).join("\n"))}</textarea></div>
    </div>
    <div class="card stack"><h2 class="card-title">Anything else?</h2>
      <div class="field"><label for="notes">Notes for Abner</label><textarea id="notes" rows="3" maxlength="1000">${esc(c.notes)}</textarea></div>
    </div>
    <button class="btn btn-primary" type="submit">Save my character</button>
  </form>`;

  document.getElementById("char").onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    let look_image = c.look_image;
    const file = document.getElementById("lookfile").files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { btn.disabled = false; return toast("Image is over 5 MB.", true); }
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
      if (!ext) { btn.disabled = false; return toast("Use PNG, JPG or WebP.", true); }
      const path = `${state.user.id}/look-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("looks").upload(path, file, { contentType: file.type });
      if (error) { btn.disabled = false; return fail(error); }
      if (c.look_image) await sb.storage.from("looks").remove([c.look_image]);
      look_image = path;
    }
    const teamOut = team.map((_, i) => ({
      species: document.getElementById("sp" + i).value.trim(),
      nickname: document.getElementById("nn" + i).value.trim(),
      note: document.getElementById("no" + i).value.trim(),
    })).filter(m => m.species);
    const unknown = teamOut.find(m => !SPECIES.includes(m.species));
    if (unknown) { btn.disabled = false; return toast(`“${unknown.species}” isn’t in the game’s Pokédex. Pick from the list.`, true); }
    const row = {
      user_id: state.user.id,
      character_name: document.getElementById("cname").value.trim(),
      team: teamOut,
      look_note: document.getElementById("looknote").value.trim(),
      look_image,
      dialogue: {
        intro: document.getElementById("dintro").value.trim(),
        defeat: document.getElementById("ddefeat").value.trim(),
        extra: document.getElementById("dextra").value.split("\n").map(s => s.trim()).filter(Boolean),
      },
      notes: document.getElementById("notes").value.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("characters").upsert(row);
    btn.disabled = false;
    if (error) return fail(error);
    toast("Saved!"); viewMe();
  };
}

// ---------- ideas & comments ----------
async function viewIdeas(kind = "idea") {
  const [{ data: posts }, { data: profiles }] = await Promise.all([
    sb.from("posts").select("*").eq("kind", kind).order("created_at", { ascending: false }),
    sb.from("profiles").select("id,display_name"),
  ]);
  const who = names(profiles);
  app.innerHTML = `
  <h1 class="page-title">${kind === "idea" ? "Idea Box" : "Comments"}</h1>
  <div class="row">
    <button class="btn btn-small ${kind === "idea" ? "btn-primary" : "btn-ghost"}" data-kind="idea">Idea Box</button>
    <button class="btn btn-small ${kind === "comment" ? "btn-primary" : "btn-ghost"}" data-kind="comment">Comments</button>
  </div>
  <form id="newpost" class="card stack">
    <div class="field"><label for="body">${kind === "idea" ? "Got an idea for the game?" : "Say something to the crew"}</label>
      <textarea id="body" rows="3" maxlength="2000" required></textarea></div>
    <button class="btn btn-gold" type="submit">Post</button>
  </form>
  <div class="stack">
    ${(posts || []).map(p => `
      <article class="post card ${kind === "idea" ? "idea" : ""}">
        <p class="post-meta">${esc(who[p.user_id])} · ${fmtDate(p.created_at)}</p>
        <p class="post-body">${esc(p.body)}</p>
        ${p.user_id === state.user.id || state.profile.is_admin ? `<button class="btn btn-ghost btn-small" data-del="${p.id}">Delete</button>` : ""}
      </article>`).join("") || `<p class="muted">Nothing here yet. Be the first!</p>`}
  </div>`;
  app.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => viewIdeas(b.dataset.kind));
  document.getElementById("newpost").onsubmit = async e => {
    e.preventDefault();
    const body = document.getElementById("body").value.trim();
    if (!body) return;
    const { error } = await sb.from("posts").insert({ kind, body });
    if (error) return fail(error);
    viewIdeas(kind);
  };
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this post?")) return;
    const { error } = await sb.from("posts").delete().eq("id", b.dataset.del);
    if (error) return fail(error);
    viewIdeas(kind);
  });
}

// ---------- admin ----------
async function viewAdmin() {
  if (!state.profile.is_admin) { location.hash = "#/home"; return; }
  const [{ data: roles }, { data: claims }, { data: profiles }, { data: chars }] = await Promise.all([
    sb.from("roles").select("*").order("sort"),
    sb.from("claims").select("*").order("created_at"),
    sb.from("profiles").select("*"),
    sb.from("characters").select("*"),
  ]);
  const who = names(profiles);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const looks = await Promise.all((chars || []).map(ch => signedLook(ch.look_image)));
  app.innerHTML = `
  <h1 class="page-title">Admin</h1>
  <div class="card stack"><h2 class="card-title">Claims</h2>
    <div class="table"><table>
      <thead><tr><th>Who</th><th>Slot</th><th>Type</th><th>Status</th><th></th></tr></thead>
      <tbody>${(claims || []).map(c => `<tr>
        <td>${esc(who[c.user_id])}</td><td>${esc(roleLabel[c.role_id])}</td><td>${typeChip(c.poke_type)}</td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
        <td class="admin-actions">
          ${c.status !== "approved" ? `<button class="btn btn-primary btn-small" data-set="${c.id}" data-status="approved">Approve</button>` : ""}
          ${c.status !== "rejected" ? `<button class="btn btn-danger btn-small" data-set="${c.id}" data-status="rejected">Reject</button>` : ""}
        </td></tr>`).join("") || `<tr><td colspan="5" class="muted">No claims yet.</td></tr>`}</tbody>
    </table></div>
  </div>
  <form id="newupdate" class="card stack"><h2 class="card-title">Post a progress update</h2>
    <div class="field"><label for="utitle">Title</label><input id="utitle" required maxlength="120"></div>
    <div class="field"><label for="umile">Milestone tag (optional)</label><input id="umile" maxlength="40" placeholder="Gym 1 done"></div>
    <div class="field"><label for="ubody">Details</label><textarea id="ubody" rows="3"></textarea></div>
    <button class="btn btn-gold" type="submit">Post update</button>
  </form>
  <div class="card stack"><h2 class="card-title">Characters</h2>
    ${(chars || []).map((ch, i) => `<details class="post">
      <summary><b>${esc(who[ch.user_id])}</b>: ${esc(ch.character_name || "(no name yet)")}</summary>
      ${looks[i] ? `<div class="look-preview"><img src="${esc(looks[i])}" alt="Look reference from ${esc(who[ch.user_id])}"></div>` : ""}
      <p><b>Look:</b> ${esc(ch.look_note)}</p>
      <p><b>Team:</b> ${(ch.team || []).map(m => esc(m.species + (m.nickname ? ` “${m.nickname}”` : "") + (m.note ? ` (${m.note})` : ""))).join(", ") || "—"}</p>
      <p><b>Intro:</b> ${esc(ch.dialogue?.intro)}</p><p><b>Defeat:</b> ${esc(ch.dialogue?.defeat)}</p>
      <p><b>Extra:</b> ${esc((ch.dialogue?.extra || []).join(" / "))}</p>
      <p><b>Notes:</b> ${esc(ch.notes)}</p>
    </details>`).join("") || `<p class="muted">Nobody has filled in a character yet.</p>`}
  </div>
  <div class="card stack"><h2 class="card-title">Export for the game</h2>
    <p class="muted">Downloads everything as one JSON file for Spark and Codex to turn into trainer data.</p>
    <button class="btn btn-ghost" id="export">Download export</button>
  </div>
  <div class="card stack"><h2 class="card-title">Adding a friend</h2>
    <p class="muted">Supabase → Authentication → Users → Add user → Create new user (tick Auto Confirm), with a temporary password.
    Send it on WhatsApp; the portal makes them pick their own on first login.</p>
  </div>`;

  app.querySelectorAll("[data-set]").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("claims").update({ status: b.dataset.status }).eq("id", b.dataset.set);
    if (error) return fail(error);
    toast(`Claim ${b.dataset.status}.`); viewAdmin();
  });
  document.getElementById("newupdate").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("updates").insert({
      title: document.getElementById("utitle").value.trim(),
      milestone: document.getElementById("umile").value.trim() || null,
      body: document.getElementById("ubody").value.trim(),
    });
    if (error) return fail(error);
    toast("Update posted."); viewAdmin();
  };
  document.getElementById("export").onclick = () => {
    const out = {
      exportedAt: new Date().toISOString(),
      roles, claims: (claims || []).map(c => ({ ...c, name: who[c.user_id] })),
      characters: (chars || []).map(ch => ({ ...ch, name: who[ch.user_id] })),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = `elg-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
}

// ---------- router ----------
const ROUTES = { home: viewHome, roles: viewRoles, me: viewMe, ideas: () => viewIdeas("idea"), admin: viewAdmin };
let recovering = false;
async function route() {
  if (!state.user) return viewLogin();
  if (recovering) return viewSetPassword(false);
  if (state.profile?.must_change_password) return viewSetPassword(true);
  showShell(true);
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || "home";
  const view = ROUTES[name] || viewHome;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === name));
  app.innerHTML = `<p class="loading">Loading…</p>`;
  try { await view(); } catch (e) { fail(e); }
}
window.addEventListener("hashchange", route);

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (event === "USER_UPDATED") recovering = false;
  const user = session?.user || null;
  if (user?.id !== state.user?.id) {
    state.user = user;
    state.profile = user ? await loadProfile() : null;
  }
  if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY") route();
});
