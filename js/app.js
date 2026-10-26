// Emerald Lost Generation: Friend Portal
// Static single-page app. All access control lives in the database (RLS);
// this file only decides what to show.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SPECIES } from "./species.js";
import { ITEMS } from "./items.js";
import { ABILITIES, MOVES } from "./pokedata.js";

const SUPABASE_URL = "https://ejworaccnktuzlevzydn.supabase.co";
const SUPABASE_KEY = "sb_publishable_Xm5oe0vRFaizEggFh_gFEQ_a1p5TdYe"; // public by design
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const TYPES = ["Normal","Fire","Water","Grass","Electric","Ice","Fighting","Poison","Ground",
  "Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"];
const TERA_TYPES = [...TYPES, "Stellar"];
const GIMMICKS = ["None", "Mega", "Z-Move", "Dynamax", "Tera"];
const MAX_ROLES = 2;
const SPECIES_SET = new Set(SPECIES), ITEMS_SET = new Set(ITEMS), MOVES_SET = new Set(MOVES);
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
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
async function signedUrls(bucket, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return {};
  const { data } = await sb.storage.from(bucket).createSignedUrls(list, 3600);
  return Object.fromEntries((data || []).filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}
function avatarHtml(p, url, lg = false) {
  const initials = (p?.display_name || "?").trim().slice(0, 2).toUpperCase();
  return url ? `<span class="avatar${lg ? " avatar-lg" : ""}"><img src="${esc(url)}" alt="${esc(p.display_name)}"></span>`
             : `<span class="avatar is-empty${lg ? " avatar-lg" : ""}" aria-hidden="true">${esc(initials)}</span>`;
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
    <hr>
    <p class="muted">First time here? Abner added your email to the invite list.</p>
    <button class="btn btn-gold" id="to-signup" type="button">Create my account</button>
  </div></div>`;
  document.getElementById("to-signup").onclick = viewSignup;
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

function viewSignup() {
  showShell(false);
  app.innerHTML = `
  <div class="auth-wrap"><div class="auth-card card stack">
    <h1 class="page-title">Join the crew</h1>
    <p class="muted">Use the email you gave Abner. Only invited emails can sign up.</p>
    <form id="signup" class="stack">
      <div class="field"><label for="sname">Username (what the group sees)</label><input id="sname" maxlength="24" required autocomplete="nickname"></div>
      <div class="field"><label for="semail">Email</label><input id="semail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="spw1">Password</label><input id="spw1" type="password" autocomplete="new-password" required>
        <p class="hint">At least 10 characters, letters and numbers.</p></div>
      <div class="field"><label for="spw2">Repeat it</label><input id="spw2" type="password" autocomplete="new-password" required></div>
      <p class="error-text" id="serr"></p>
      <button class="btn btn-primary" type="submit">Create account</button>
    </form>
    <button class="btn btn-ghost btn-small" id="to-login" type="button">I already have an account</button>
  </div></div>`;
  document.getElementById("to-login").onclick = viewLogin;
  document.getElementById("signup").onsubmit = async e => {
    e.preventDefault();
    const err = document.getElementById("serr"), pw = document.getElementById("spw1").value;
    if (pw !== document.getElementById("spw2").value) return (err.textContent = "Passwords don’t match.");
    const problem = passwordProblem(pw); if (problem) return (err.textContent = problem);
    err.textContent = "";
    const btn = e.submitter; btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: document.getElementById("semail").value.trim().toLowerCase(),
      password: pw,
      options: { data: { display_name: document.getElementById("sname").value.trim(), self_signup: true } },
    });
    btn.disabled = false;
    if (error) {
      // The database refuses emails that aren't on the invite list ("Database error saving new user")
      if (/database error|not_invited/i.test(error.message)) return (err.textContent = "That email isn’t on the invite list. Ask Abner to add it, then try again.");
      if (/already registered/i.test(error.message)) return (err.textContent = "That email already has an account. Log in instead.");
      return (err.textContent = error.message);
    }
    if (!data.session) return toast("Account created! Check your email to confirm, then log in.");
    toast("Welcome to the crew!");
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

// ===== HOME =====
async function viewHome() {
  const [{ data: updates }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("updates").select("*").order("created_at", { ascending: false }),
    sb.from("claims").select("role_id,user_id,poke_type,status").neq("status", "rejected"),
    sb.from("roles").select("id,label,claimable,category"),
  ]);
  const mine = (claims || []).filter(c => c.user_id === state.user.id);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const slots = (roles || []).filter(r => r.claimable && r.category !== "custom").map(r => r.id);
  const taken = (claims || []).filter(c => slots.includes(c.role_id)).length;
  app.innerHTML = `
  <h1 class="page-title">Hey ${esc(state.profile.display_name)}!</h1>
  <div class="grid">
    <div class="card stack"><h2 class="card-title">Your role${mine.length > 1 ? "s" : ""}</h2>
      ${mine.length ? mine.map(c => `<p>${esc(roleLabel[c.role_id])} ${typeChip(c.poke_type)} <span class="badge badge-${c.status}">${c.status}</span></p>`).join("")
                    : `<p class="muted">No role yet.</p><a class="btn btn-gold" href="#/roles">Pick a role</a>`}
    </div>
    <div class="card stack"><h2 class="card-title">The crew</h2>
      <p><b>${taken}</b> of ${slots.length} slots claimed.</p>
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

// ===== ROLES =====
async function viewRoles() {
  const [{ data: roles }, { data: claims }, { data: profiles }, { data: requests }] = await Promise.all([
    sb.from("roles").select("*").order("sort"),
    sb.from("claims").select("*").neq("status", "rejected"),
    sb.from("profiles").select("id,display_name"),
    sb.from("role_requests").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }),
  ]);
  const who = names(profiles);
  const bySlot = Object.fromEntries((claims || []).map(c => [c.role_id, c]));
  const mine = (claims || []).filter(c => c.user_id === state.user.id);
  const canClaim = mine.length < MAX_ROLES;
  const second = mine.length === 1;
  const takenTypes = new Set((claims || []).map(c => c.poke_type).filter(Boolean));
  const freeTypes = TYPES.filter(t => !takenTypes.has(t));

  const slotHtml = r => {
    const c = bySlot[r.id];
    let body;
    if (!r.claimable && !c) body = `<span class="badge badge-reserved">Reserved</span><p class="muted">Abner decides this one.</p>`;
    else if (c) body = `<p class="slot-holder">${esc(who[c.user_id])} ${typeChip(c.poke_type)}</p>
        <span class="badge badge-${c.status}">${c.status === "approved" ? "Taken" : "Pending"}</span>
        ${c.user_id === state.user.id && c.status === "pending" ? `<button class="btn btn-ghost btn-small" data-drop="${c.id}">Drop claim</button>` : ""}
        ${state.profile.is_admin ? `<div class="slot-action"><button class="btn btn-ghost btn-small" data-view="${c.user_id}">View submission</button></div>` : ""}`;
    else if (!canClaim) body = `<span class="badge badge-open">Open</span>`;
    else body = `<span class="badge badge-open">Open</span>
        ${r.needs_type ? `<select data-type-for="${r.id}" aria-label="Type for ${esc(r.label)}">
           <option value="">Pick a type…</option>${freeTypes.map(t => `<option>${t}</option>`).join("")}</select>` : ""}
        ${second ? `<div class="reason-box field"><label for="why-${r.id}">Why a second role?</label>
           <textarea id="why-${r.id}" data-reason-for="${r.id}" rows="2" maxlength="1000" placeholder="Your idea for playing both"></textarea></div>` : ""}
        <button class="btn btn-gold btn-small" data-claim="${r.id}">Claim</button>`;
    const cls = ["slot", "card", c?.user_id === state.user.id ? "is-mine" : "", !r.claimable && !c ? "is-reserved" : ""].join(" ");
    return `<div class="${cls}"><div class="slot-head"><h3 class="card-title">${esc(r.label)}</h3></div>
      <p class="team-size-note">First battle · ${r.first_team_size} Pokémon · Rematch · 6</p>${body}</div>`;
  };
  const group = (title, cats) => {
    const list = (roles || []).filter(r => cats.includes(r.category));
    return list.length ? `<h2 class="page-title">${title}</h2><div class="grid">${list.map(slotHtml).join("")}</div>` : "";
  };
  app.innerHTML = `
    <h1 class="page-title">Roles</h1>
    <p class="muted">${mine.length === 0 ? "Claim a slot. Gym Leaders and the Elite Four each pick a type nobody else has."
      : mine.length === 1 ? "You have 1 role. You can claim a second one if you tell Abner why."
      : "You hold the maximum of 2 roles."} Abner approves every claim.</p>
    ${group("Gym Leaders", ["gym"])}
    ${group("Elite Four & Champion", ["elite4", "champion"])}
    ${group("Villains & Professor", ["aqua", "magma", "professor"])}
    ${group("Custom roles", ["custom"])}
    <form id="rolereq" class="request-card card stack"><h2 class="card-title">Want a role that isn’t listed?</h2>
      <p class="muted">Like a spy in Team Magma, a rival or a side character. Tell Abner the idea; if he approves, the role is created for you.</p>
      <div class="field"><label for="rqname">Role name</label><input id="rqname" maxlength="40" required placeholder="Team Magma Spy"></div>
      <div class="field"><label for="rqwhy">Your idea and why</label><textarea id="rqwhy" rows="3" maxlength="1000" required></textarea></div>
      <button class="btn btn-gold" type="submit" ${canClaim ? "" : "disabled"}>Send request</button>
      ${canClaim ? "" : `<p class="hint">You already hold 2 roles.</p>`}
      ${(requests || []).length ? `<ul class="request-list">${requests.map(q => `<li class="request-item">
        <b>${esc(q.role_name)}</b> <span class="badge badge-${q.status}">${q.status}</span>
        <p class="request-reason muted">${esc(q.reason)}</p><p class="meta-date">${esc(fmtDateTime(q.created_at))}</p>
        ${q.status === "pending" ? `<button class="btn btn-ghost btn-small" type="button" data-unrequest="${q.id}">Cancel request</button>` : ""}
      </li>`).join("")}</ul>` : ""}
    </form>`;

  app.querySelectorAll("[data-claim]").forEach(b => b.onclick = async () => {
    const roleId = b.dataset.claim;
    const sel = app.querySelector(`[data-type-for="${roleId}"]`);
    const why = app.querySelector(`[data-reason-for="${roleId}"]`);
    if (sel && !sel.value) return toast("Pick a type first.", true);
    if (why && why.value.trim().length < 5) return toast("Tell Abner why you want a second role.", true);
    b.disabled = true;
    const { error } = await sb.from("claims").insert({ role_id: roleId, poke_type: sel ? sel.value : null, reason: why ? why.value.trim() : "" });
    if (error) { b.disabled = false; return fail(error); }
    toast("Claimed! Waiting for Abner’s approval.");
    viewRoles();
  });
  app.querySelectorAll("[data-view]").forEach(b => b.onclick = () => openSubmission(b.dataset.view, who[b.dataset.view]));
  app.querySelectorAll("[data-drop]").forEach(b => b.onclick = async () => {
    if (!confirm("Drop your claim?")) return;
    const { error } = await sb.from("claims").delete().eq("id", b.dataset.drop);
    if (error) return fail(error);
    toast("Claim dropped."); viewRoles();
  });
  document.getElementById("rolereq").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("role_requests").insert({
      role_name: document.getElementById("rqname").value.trim(),
      reason: document.getElementById("rqwhy").value.trim(),
    });
    if (error) return fail(error);
    toast("Request sent to Abner."); viewRoles();
  };
  app.querySelectorAll("[data-unrequest]").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("role_requests").delete().eq("id", b.dataset.unrequest);
    if (error) return fail(error);
    viewRoles();
  });
}


// ---------- admin: a friend's submission + dated history (opened from Roles) ----------
function characterDetails(s, imgUrl, roleLabel = {}) {
  const perRole = Object.entries(s.roles || {}).map(([k, r]) => {
    const d = r.dialogue || {};
    return `<div class="role-entry stack"><h3 class="card-title">${esc(roleLabel[k] || k)}${r.title ? `: ${esc(r.title)}` : ""}</h3>
      ${r.signature_move?.name ? `<p><b>Signature move:</b> ${esc(r.signature_move.name)}${r.signature_move.description ? `: ${esc(r.signature_move.description)}` : ""}</p>` : ""}
      <p><b>First battle:</b> ${teamSummary(r.first_team)}</p>
      <p><b>Rematch:</b> ${teamSummary(r.rematch_team)}</p>
      <p><b>Before battle:</b> ${esc(d.intro || "—")}</p>
      <p><b>When they lose:</b> ${esc(d.defeat || "—")}</p>
      <p><b>Extra:</b> ${esc((d.extra || []).join(" / ") || "—")}</p></div>`;
  }).join("");
  return `
    ${imgUrl ? `<div class="look-preview"><img src="${esc(imgUrl)}" alt="Look reference"></div>` : ""}
    <p><b>Character:</b> ${esc(s.character_name || "—")}</p>
    <p><b>Look:</b> ${esc(s.look_note || "—")}</p>
    ${perRole || `<p><b>Team (old format):</b> ${teamSummary(s.team)}</p>`}
    <p><b>Notes:</b> ${esc(s.notes || "—")}</p>`;
}
async function openSubmission(userId, name) {
  const sheet = document.getElementById("sheet");
  sheet.innerHTML = `<p class="loading">Loading…</p>`;
  if (!sheet.open) sheet.showModal();
  const [{ data: history, error }, { data: prof }, { data: roles }] = await Promise.all([
    sb.from("character_history").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    sb.from("profiles").select("approved_history_id,approved_at").eq("id", userId).single(),
    sb.from("roles").select("id,label"),
  ]);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  if (error) { sheet.close(); return fail(error); }
  const urls = await signedUrls("looks", (history || []).map(h => h.snapshot.look_image));
  sheet.innerHTML = `
    <div class="panel-head"><h2 class="card-title">${esc(name)}’s submission</h2>
      <button class="btn btn-ghost btn-small panel-close" type="button" id="sheet-close">Close</button></div>
    ${!history?.length ? `<p class="muted">${esc(name)} hasn’t filled in a character yet.</p>` : `
    <ol class="history">
      ${history.map((h, i) => {
        const approved = prof?.approved_history_id === h.id;
        return `<li class="history-item${i === 0 ? " is-latest" : ""}${approved ? " is-approved" : ""}">
          <details ${i === 0 ? "open" : ""}>
            <summary><span class="history-date">${esc(fmtDateTime(h.created_at))}</span>
              ${i === 0 ? `<span class="badge badge-open">Latest</span>` : ""}
              ${approved ? `<span class="approved-mark">Approved ${esc(fmtDate(prof.approved_at))}</span>` : ""}</summary>
            ${characterDetails(h.snapshot, urls[h.snapshot.look_image], roleLabel)}
            ${approved ? "" : `<button class="btn btn-primary btn-small" data-approve="${h.id}">Approve this version</button>`}
          </details></li>`;
      }).join("")}
    </ol>`}`;
  document.getElementById("sheet-close").onclick = () => sheet.close();
  sheet.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error: e } = await sb.rpc("approve_character", { p_history_id: Number(b.dataset.approve) });
    if (e) { b.disabled = false; return fail(e); }
    toast(`${name}’s name and titles are approved.`);
    openSubmission(userId, name);
  });
}
document.getElementById("sheet").addEventListener("click", e => { if (e.target.id === "sheet") e.target.close(); });

// ---------- crew profiles ----------
async function viewProfiles() {
  const [{ data: profiles }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("profiles").select("id,display_name,avatar_path,approved_titles,approved_character_name").order("display_name"),
    sb.from("claims").select("user_id,role_id,poke_type,status").neq("status", "rejected"),
    sb.from("roles").select("id,label"),
  ]);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const claimsOf = {};
  (claims || []).forEach(c => (claimsOf[c.user_id] ||= []).push(c));
  const urls = await signedUrls("avatars", (profiles || []).map(p => p.avatar_path));
  app.innerHTML = `
    <h1 class="page-title">The Crew</h1>
    <div class="profile-grid">
      ${(profiles || []).map(p => {
        const cs = claimsOf[p.id] || [];
        const titles = p.approved_titles || {};
        return `<a class="profile-card card" href="#/profile/${p.id}">
          ${avatarHtml(p, urls[p.avatar_path])}
          <p class="profile-name">${esc(p.display_name)}</p>
          ${p.approved_character_name ? `<p class="profile-character">${esc(p.approved_character_name)}</p>` : ""}
          ${cs.length ? cs.map(c => `<p class="muted">${titles[c.role_id] ? `<span class="profile-title">${esc(titles[c.role_id])}</span> · ` : ""}${esc(roleLabel[c.role_id])} ${typeChip(c.poke_type)}</p>`).join("")
                      : `<p class="muted">No role yet</p>`}
        </a>`;
      }).join("")}
    </div>`;
}

async function viewProfile(id) {
  const isMe = id === state.user.id;
  const [{ data: p, error }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("profiles").select("id,display_name,avatar_path,approved_titles,approved_character_name,approved_at").eq("id", id).single(),
    sb.from("claims").select("role_id,poke_type,status").eq("user_id", id).neq("status", "rejected").order("created_at"),
    sb.from("roles").select("id,label"),
  ]);
  if (error) return fail(error);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const urls = await signedUrls("avatars", [p.avatar_path]);
  // Teams are private: only the owner and the admin can read characters (enforced by RLS)
  let ch = null;
  if (isMe || state.profile.is_admin) ({ data: ch } = await sb.from("characters").select("roles").eq("user_id", id).maybeSingle());
  const titles = p.approved_titles || {};
  app.innerHTML = `
    <p><a href="#/profile" class="btn btn-ghost btn-small">← The Crew</a></p>
    <div class="profile-card card">
      ${avatarHtml(p, urls[p.avatar_path], true)}
      <h1 class="profile-name page-title">${esc(p.display_name)}</h1>
      ${p.approved_character_name ? `<p class="profile-character">${esc(p.approved_character_name)}</p>` : `<p class="muted">Character not approved yet</p>`}
      ${(claims || []).length ? claims.map(c => `<p>${titles[c.role_id] ? `<span class="profile-title">${esc(titles[c.role_id])}</span><br>` : ""}${esc(roleLabel[c.role_id])} ${typeChip(c.poke_type)} <span class="badge badge-${c.status}">${c.status === "approved" ? "Taken" : "Pending"}</span></p>`).join("")
                              : `<p class="muted">No role yet</p>`}
    </div>
    ${isMe || state.profile.is_admin ? `
    <div class="profile-private card stack">
      <p class="private-note">Only ${isMe ? "you" : esc(p.display_name)} and Abner can see this</p>
      <h2 class="card-title">Teams</h2>
      ${Object.keys(ch?.roles || {}).length ? Object.entries(ch.roles).map(([k, r]) => `<div class="stack"><h3 class="team-section-title">${esc(roleLabel[k] || k)}</h3>
        <p><b>First battle:</b> ${teamSummary(r.first_team)}</p><p><b>Rematch:</b> ${teamSummary(r.rematch_team)}</p></div>`).join("")
        : `<p class="muted">No teams yet.</p>`}
    </div>` : ""}
    ${isMe ? `
    <form id="profedit" class="card stack"><h2 class="card-title">Edit my profile</h2>
      <div class="field"><label for="pname">Username</label><input id="pname" maxlength="24" value="${esc(p.display_name)}"></div>
      <div class="field"><label for="pavatar">Profile picture (PNG, JPG or WebP, max 2 MB)</label><input id="pavatar" type="file" accept="image/png,image/jpeg,image/webp"></div>
      <button class="btn btn-primary" type="submit">Save profile</button>
    </form>` : ""}`;

  if (!isMe) return;
  document.getElementById("profedit").onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    const patch = { display_name: document.getElementById("pname").value.trim() || p.display_name };
    const file = document.getElementById("pavatar").files[0];
    if (file) {
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
      if (!ext || file.size > 2 * 1024 * 1024) { btn.disabled = false; return toast("Use a PNG, JPG or WebP under 2 MB.", true); }
      const path = `${state.user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, file, { contentType: file.type });
      if (upErr) { btn.disabled = false; return fail(upErr); }
      if (p.avatar_path) await sb.storage.from("avatars").remove([p.avatar_path]);
      patch.avatar_path = path;
    }
    const { error: e2 } = await sb.from("profiles").update(patch).eq("id", state.user.id);
    btn.disabled = false;
    if (e2) return fail(e2);
    state.profile = { ...state.profile, ...patch };
    toast("Profile saved."); viewProfile(id);
  };
}

// ===== TEAM BUILDER (shared by My Character) =====
function abilityOptions(species, current) {
  const list = ABILITIES[species] || [];
  if (!list.length) return `<option value="">Pick a Pokémon first</option>`;
  return `<option value="">Pick an ability…</option>` + list.map(a => `<option${a === current ? " selected" : ""}>${esc(a)}</option>`).join("");
}
function pokeSlotHtml(key, i, m) {
  const id = `${key}-${i}`;
  const g = m.gimmick || "None";
  return `<div class="poke-slot stack">
    <span class="poke-slot-num">${i + 1}</span>
    <div class="field"><label for="sp-${id}">Pokémon</label><input id="sp-${id}" list="species" value="${esc(m.species)}" autocomplete="off" data-species-for="${id}"></div>
    <div class="field"><label for="nn-${id}">Nickname</label><input id="nn-${id}" maxlength="12" value="${esc(m.nickname)}"></div>
    <div class="field"><label for="it-${id}">Held item</label><input id="it-${id}" list="items" value="${esc(m.item)}" autocomplete="off"></div>
    <div class="field"><label for="ab-${id}">Ability</label><select id="ab-${id}" data-ability-for="${id}">${abilityOptions(m.species, m.ability)}</select></div>
    <div class="moves-grid">${[0, 1, 2, 3].map(j => `<div class="field"><label for="mv-${id}-${j}">Move ${j + 1}</label>
      <input id="mv-${id}-${j}" list="moves" value="${esc((m.moves || [])[j])}" autocomplete="off"></div>`).join("")}</div>
    <div class="field"><label for="gm-${id}">Gimmick</label><select id="gm-${id}" data-gimmick="${id}">
      ${GIMMICKS.map(x => `<option${x === g ? " selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="field tera-field" id="tf-${id}" ${g === "Tera" ? "" : "hidden"}><label for="tt-${id}">Tera type</label><select id="tt-${id}">
      <option value="">Pick…</option>${TERA_TYPES.map(t => `<option${t === m.tera ? " selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="field"><label for="no-${id}">Note (strategy, EVs, nature…)</label><input id="no-${id}" maxlength="120" value="${esc(m.note)}"></div>
  </div>`;
}
function readTeam(key, size) {
  const out = [];
  for (let i = 0; i < size; i++) {
    const v = s => document.getElementById(`${s}-${key}-${i}`)?.value.trim() || "";
    const moves = [0, 1, 2, 3].map(j => document.getElementById(`mv-${key}-${i}-${j}`)?.value.trim() || "").filter(Boolean);
    const m = { species: v("sp"), nickname: v("nn"), item: v("it"), ability: v("ab"), moves,
      gimmick: v("gm") || "None", tera: v("gm") === "Tera" ? v("tt") : "", note: v("no") };
    if (m.species) out.push(m);
  }
  return out;
}
function teamProblem(team, label) {
  const badSpecies = team.find(m => !SPECIES_SET.has(m.species));
  if (badSpecies) return `${label}: “${badSpecies.species}” isn’t in the game’s Pokédex. Pick from the list.`;
  const badItem = team.find(m => m.item && !ITEMS_SET.has(m.item));
  if (badItem) return `${label}: “${badItem.item}” isn’t an item in the game. Pick from the list.`;
  const badAbility = team.find(m => m.ability && !(ABILITIES[m.species] || []).includes(m.ability));
  if (badAbility) return `${label}: ${badAbility.species} can’t have ${badAbility.ability}.`;
  const badMove = team.find(m => (m.moves || []).some(x => !MOVES_SET.has(x)));
  if (badMove) return `${label}: “${badMove.moves.find(x => !MOVES_SET.has(x))}” isn’t a move in the game. Pick from the list.`;
  const dupMove = team.find(m => new Set(m.moves || []).size !== (m.moves || []).length);
  if (dupMove) return `${label}: ${dupMove.species} has the same move twice.`;
  const noTera = team.find(m => m.gimmick === "Tera" && !m.tera);
  if (noTera) return `${label}: pick a Tera type for ${noTera.species}.`;
  return null;
}
function teamSummary(team) {
  return (team || []).map(m => esc(m.species + (m.nickname ? ` “${m.nickname}”` : "")
    + (m.item ? ` @ ${m.item}` : "") + (m.ability ? ` · ${m.ability}` : "")
    + ((m.moves || []).length ? ` · ${m.moves.join(" / ")}` : "")
    + (m.gimmick && m.gimmick !== "None" ? ` [${m.gimmick}${m.tera ? ` ${m.tera}` : ""}]` : "")
    + (m.note ? ` (${m.note})` : ""))).join(", ") || "—";
}

// ===== MY CHARACTER =====
async function signedLook(path) {
  if (!path) return null;
  const { data } = await sb.storage.from("looks").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}
async function viewMe() {
  const [{ data: ch }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("characters").select("*").eq("user_id", state.user.id).maybeSingle(),
    sb.from("claims").select("*").eq("user_id", state.user.id).neq("status", "rejected").order("created_at"),
    sb.from("roles").select("*"),
  ]);
  const c = ch || { character_name: "", look_note: "", look_image: null, notes: "", roles: {} };
  const roleById = Object.fromEntries((roles || []).map(r => [r.id, r]));
  const prof = state.profile;
  const changedSinceApproval = prof.approved_at && ch && new Date(ch.updated_at) > new Date(prof.approved_at);
  const approvalHtml = prof.approved_at
    ? `<p><span class="approved-mark">Approved ${esc(fmtDate(prof.approved_at))}</span> ${esc(prof.approved_character_name || "")}</p>
       ${changedSinceApproval ? `<p class="hint">You changed things since then. Abner will review the new version.</p>` : ""}`
    : `<p class="muted">Not approved yet. Abner reviews every version you save.</p>`;
  const lookUrl = await signedLook(c.look_image);
  const myRoles = (claims || []).map(cl => ({ claim: cl, role: roleById[cl.role_id], data: (c.roles || {})[cl.role_id] || {} }));

  const roleEntryHtml = ({ claim, role, data }) => {
    const d = data.dialogue || {};
    const k = role.id;
    const first = Array.from({ length: role.first_team_size }, (_, i) => (data.first_team || [])[i] || {});
    const rematch = Array.from({ length: 6 }, (_, i) => (data.rematch_team || [])[i] || {});
    return `<section class="role-entry card stack">
      <div class="role-entry-head"><h2 class="card-title">${esc(role.label)}</h2> ${typeChip(claim.poke_type)}
        <span class="badge badge-${claim.status}">${claim.status}</span></div>
      <div class="field"><label for="title-${k}">Title for this role</label><input id="title-${k}" maxlength="24" value="${esc(data.title)}" placeholder="${claim.poke_type ? `The ${esc(claim.poke_type)} Master` : "Shadow Agent"}">
        <p class="hint">Shown before your name, like a trainer class.</p></div>
      ${role.category === "gym" ? `<div class="signature-move stack">
        <h3 class="signature-title">Signature move</h3>
        <p class="hint">Gym Leaders only. Pick a move or invent your own.</p>
        <div class="field"><label for="sig-${k}">Move</label><input id="sig-${k}" list="moves" maxlength="40" value="${esc(data.signature_move?.name)}" autocomplete="off"></div>
        <div class="field"><label for="sigd-${k}">What it does</label><textarea id="sigd-${k}" rows="2" maxlength="300">${esc(data.signature_move?.description)}</textarea></div>
      </div>` : ""}
      <div class="team-section first stack">
        <div class="team-section-head"><h3 class="team-section-title">First battle</h3>
          <span class="team-size-note">${role.first_team_size} Pokémon${claim.poke_type ? ` · ${esc(claim.poke_type)} specialist` : " · any type"}</span></div>
        <div class="team-grid">${first.map((m, i) => pokeSlotHtml(`${k}-f`, i, m)).join("")}</div>
      </div>
      <div class="team-section rematch stack">
        <div class="team-section-head"><h3 class="team-section-title">Rematch (after the Elite Four)</h3>
          <span class="team-size-note">Full team of 6</span></div>
        <div class="team-grid">${rematch.map((m, i) => pokeSlotHtml(`${k}-r`, i, m)).join("")}</div>
      </div>
      <div class="stack"><h3 class="team-section-title">What you say as ${esc(role.label)}</h3>
        <div class="field"><label for="di-${k}">Before the battle</label><textarea id="di-${k}" rows="2" maxlength="300">${esc(d.intro)}</textarea></div>
        <div class="field"><label for="dd-${k}">When you lose</label><textarea id="dd-${k}" rows="2" maxlength="300">${esc(d.defeat)}</textarea></div>
        <div class="field"><label for="dx-${k}">Extra lines (one per line)</label><textarea id="dx-${k}" rows="3" maxlength="800">${esc((d.extra || []).join("\n"))}</textarea></div>
      </div>
    </section>`;
  };

  app.innerHTML = `
  <h1 class="page-title">My Character</h1>
  <p class="muted">Only you and Abner can see this page’s answers. Teams stay secret so nobody can prep against you.</p>
  <datalist id="species">${SPECIES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  <datalist id="items">${ITEMS.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  <datalist id="moves">${MOVES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  <form id="char" class="stack">
    <div class="card stack"><h2 class="card-title">Who are you in the game?</h2>
      ${ch ? `<p class="meta-date">Last saved ${esc(fmtDateTime(ch.updated_at))}</p>` : ""}
      ${approvalHtml}
      <div class="field"><label for="cname">Character name</label><input id="cname" maxlength="12" value="${esc(c.character_name)}">
        <p class="hint">Same character in every role. GBA names fit 12 characters.</p></div>
    </div>
    <div class="card stack"><h2 class="card-title">Your look</h2>
      <div class="look-preview">${lookUrl ? `<img src="${esc(lookUrl)}" alt="Your look reference">` : `<p class="muted">No image yet.</p>`}</div>
      <div class="field"><label for="lookfile">Reference image (PNG, JPG or WebP, max 5 MB)</label><input id="lookfile" type="file" accept="image/png,image/jpeg,image/webp"></div>
      <div class="field"><label for="looknote">Describe it</label><textarea id="looknote" rows="3" maxlength="600">${esc(c.look_note)}</textarea></div>
    </div>
    ${myRoles.length ? myRoles.map(roleEntryHtml).join("")
      : `<div class="card"><p class="muted">Claim a role first, then build its teams here.</p><a class="btn btn-gold" href="#/roles">Pick a role</a></div>`}
    <div class="card stack"><h2 class="card-title">Anything else?</h2>
      <div class="field"><label for="notes">Notes for Abner</label><textarea id="notes" rows="3" maxlength="1000">${esc(c.notes)}</textarea></div>
    </div>
    <button class="btn btn-primary" type="submit">Save my character</button>
  </form>`;

  app.querySelectorAll("[data-species-for]").forEach(inp => inp.onchange = () => {
    const sel = document.getElementById(`ab-${inp.dataset.speciesFor}`);
    sel.innerHTML = abilityOptions(inp.value.trim(), sel.value);
  });
  app.querySelectorAll("[data-gimmick]").forEach(sel => sel.onchange = () => {
    document.getElementById(`tf-${sel.dataset.gimmick}`).hidden = sel.value !== "Tera";
  });

  document.getElementById("char").onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    const rolesOut = {};
    for (const { role } of myRoles) {
      const k = role.id;
      const first = readTeam(`${k}-f`, role.first_team_size), rematch = readTeam(`${k}-r`, 6);
      const problem = teamProblem(first, `${role.label} first battle`) || teamProblem(rematch, `${role.label} rematch`);
      if (problem) { btn.disabled = false; return toast(problem, true); }
      rolesOut[k] = {
        title: document.getElementById(`title-${k}`).value.trim(),
        ...(role.category === "gym" ? { signature_move: {
          name: document.getElementById(`sig-${k}`).value.trim(),
          description: document.getElementById(`sigd-${k}`).value.trim(),
        } } : {}),
        first_team: first,
        rematch_team: rematch,
        dialogue: {
          intro: document.getElementById(`di-${k}`).value.trim(),
          defeat: document.getElementById(`dd-${k}`).value.trim(),
          extra: document.getElementById(`dx-${k}`).value.split("\n").map(s => s.trim()).filter(Boolean),
        },
      };
    }
    let look_image = c.look_image;
    const file = document.getElementById("lookfile").files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { btn.disabled = false; return toast("Image is over 5 MB.", true); }
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
      if (!ext) { btn.disabled = false; return toast("Use PNG, JPG or WebP.", true); }
      const path = `${state.user.id}/look-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("looks").upload(path, file, { contentType: file.type });
      if (error) { btn.disabled = false; return fail(error); }
      look_image = path; // old images are kept so the version history still shows them
    }
    const { error } = await sb.from("characters").upsert({
      user_id: state.user.id,
      character_name: document.getElementById("cname").value.trim(),
      look_note: document.getElementById("looknote").value.trim(),
      look_image,
      notes: document.getElementById("notes").value.trim(),
      roles: rolesOut,
    });
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
  const [{ data: roles }, { data: claims }, { data: profiles }, { data: chars }, { data: invites }, { data: requests }] = await Promise.all([
    sb.from("roles").select("*").order("sort"),
    sb.from("claims").select("*").order("created_at"),
    sb.from("profiles").select("*"),
    sb.from("characters").select("*"),
    sb.from("invites").select("*").order("added_at"),
    sb.from("role_requests").select("*").order("created_at", { ascending: false }),
  ]);
  const who = names(profiles);
  const approvedOf = Object.fromEntries((profiles || []).map(p => [p.id, { title: p.approved_title, character_name: p.approved_character_name, approved_at: p.approved_at }]));
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
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
          <button class="btn btn-ghost btn-small" data-unclaim="${c.id}" data-who="${esc(who[c.user_id])}" data-role="${esc(roleLabel[c.role_id])}">Remove</button>
        </td></tr>`).join("") || `<tr><td colspan="5" class="muted">No claims yet.</td></tr>`}</tbody>
    </table></div>
  </div>
  <div class="request-card card stack"><h2 class="card-title">Custom role requests</h2>
    ${(requests || []).length ? `<ul class="request-list">${requests.map(q => `<li class="request-item stack">
      <p><b>${esc(who[q.user_id])}</b> wants <b>${esc(q.role_name)}</b> <span class="badge badge-${q.status}">${q.status}</span></p>
      <p class="request-reason muted">${esc(q.reason)}</p><p class="meta-date">${esc(fmtDateTime(q.created_at))}</p>
      ${q.status === "pending" ? `<div class="row">
        <div class="field"><label for="rql-${q.id}">Role name</label><input id="rql-${q.id}" maxlength="40" value="${esc(q.role_name)}"></div>
        <div class="field"><label for="rqs-${q.id}">First battle size</label><input id="rqs-${q.id}" class="size-input" type="number" min="1" max="6" value="4"></div>
      </div>
      <div class="admin-actions">
        <button class="btn btn-primary btn-small" type="button" data-rq-approve="${q.id}">Approve &amp; create role</button>
        <button class="btn btn-danger btn-small" type="button" data-rq-reject="${q.id}">Reject</button>
      </div>` : ""}
    </li>`).join("")}</ul>` : `<p class="muted">No requests yet.</p>`}
  </div>
  <form id="sizes" class="card stack"><h2 class="card-title">Roles &amp; team sizes</h2>
    <p class="muted">First-battle size per role (rematches are always 6). Deleting a role also removes its claims and that role’s teams.</p>
    <div class="size-table table"><table>
      <thead><tr><th>Role</th><th>Held by</th><th>First battle</th><th></th></tr></thead>
      <tbody>${(roles || []).map(r => {
        const holders = (claims || []).filter(c => c.role_id === r.id && c.status !== "rejected").map(c => who[c.user_id]);
        return `<tr><td>${esc(r.label)}</td><td>${holders.length ? esc(holders.join(", ")) : `<span class="muted">open</span>`}</td>
        <td><input class="size-input" type="number" min="1" max="6" value="${r.first_team_size}" data-size-for="${esc(r.id)}" aria-label="First battle size for ${esc(r.label)}"></td>
        <td class="admin-actions"><button class="btn btn-danger btn-small" type="button" data-delrole="${esc(r.id)}" data-label="${esc(r.label)}" data-held="${holders.length}">Delete</button></td></tr>`;
      }).join("")}</tbody>
    </table></div>
    <button class="btn btn-gold" type="submit">Save sizes</button>
  </form>
  <form id="assign" class="card stack"><h2 class="card-title">Assign a role</h2>
    <p class="muted">Gives a friend a role, already approved. They can still only hold 2.</p>
    <div class="field"><label for="as-user">Friend</label><select id="as-user" required>
      <option value="">Pick a friend…</option>${(profiles || []).map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join("")}</select></div>
    <div class="field"><label for="as-role">Role</label><select id="as-role" required>
      <option value="">Pick a role…</option>${(roles || []).filter(r => !(claims || []).some(c => c.role_id === r.id && c.status !== "rejected"))
        .map(r => `<option value="${esc(r.id)}" data-needs-type="${r.needs_type}">${esc(r.label)}</option>`).join("")}</select></div>
    <div class="field" id="as-type-field" hidden><label for="as-type">Type</label><select id="as-type">
      <option value="">Pick a type…</option>${TYPES.filter(t => !(claims || []).some(c => c.poke_type === t && c.status !== "rejected")).map(t => `<option>${t}</option>`).join("")}</select></div>
    <button class="btn btn-primary" type="submit">Assign role</button>
  </form>
  <form id="newrole" class="card stack"><h2 class="card-title">Create a role</h2>
    <p class="muted">Add a slot yourself. Friends can then claim it (or assign it above).</p>
    <div class="field"><label for="nr-label">Role name</label><input id="nr-label" maxlength="40" required placeholder="Team Aqua Admin"></div>
    <div class="row">
      <div class="field"><label for="nr-cat">Kind</label><select id="nr-cat">
        <option value="custom">Custom (no type)</option><option value="gym">Gym Leader (type)</option><option value="elite4">Elite Four (type)</option>
        <option value="aqua">Team Aqua</option><option value="magma">Team Magma</option><option value="professor">Professor</option></select></div>
      <div class="field"><label for="nr-size">First battle size</label><input id="nr-size" class="size-input" type="number" min="1" max="6" value="4"></div>
    </div>
    <button class="btn btn-gold" type="submit">Create role</button>
  </form>
  <form id="newupdate" class="card stack"><h2 class="card-title">Post a progress update</h2>
    <div class="field"><label for="utitle">Title</label><input id="utitle" required maxlength="120"></div>
    <div class="field"><label for="umile">Milestone tag (optional)</label><input id="umile" maxlength="40" placeholder="Gym 1 done"></div>
    <div class="field"><label for="ubody">Details</label><textarea id="ubody" rows="3"></textarea></div>
    <button class="btn btn-gold" type="submit">Post update</button>
  </form>
  <div class="card stack"><h2 class="card-title">Export for the game</h2>
    <p class="muted">Character submissions now open from each slot on the Roles page. Downloads everything as one JSON file for Spark and Codex to turn into trainer data.</p>
    <button class="btn btn-ghost" id="export">Download export</button>
  </div>
  <form id="newinvite" class="card stack"><h2 class="card-title">Invited emails</h2>
    <p class="muted">Only these emails can create an account. Add a friend’s email, then send them the portal link.</p>
    <div class="row">
      <div class="field"><label for="iemail">Email</label><input id="iemail" type="email" required></div>
      <div class="field"><label for="inote">Who is it?</label><input id="inote" maxlength="40" placeholder="Carlos"></div>
    </div>
    <button class="btn btn-gold" type="submit">Add to invite list</button>
    <div class="table"><table>
      <thead><tr><th>Email</th><th>Who</th><th>Status</th><th></th></tr></thead>
      <tbody>${(invites || []).map(i => `<tr>
        <td>${esc(i.email)}</td><td>${esc(i.note)}</td>
        <td>${i.used_at ? `<span class="badge badge-approved">Joined ${esc(fmtDate(i.used_at))}</span>` : `<span class="badge badge-pending">Not joined yet</span>`}</td>
        <td class="admin-actions">${i.used_at ? "" : `<button class="btn btn-danger btn-small" type="button" data-uninvite="${esc(i.email)}">Remove</button>`}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="muted">Nobody invited yet.</td></tr>`}</tbody>
    </table></div>
  </form>`;

  document.getElementById("newinvite").onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById("iemail").value.trim().toLowerCase();
    const { error } = await sb.from("invites").insert({ email, note: document.getElementById("inote").value.trim() });
    if (error) return /duplicate/.test(error.message) ? toast("That email is already invited.", true) : fail(error);
    toast(`${email} can now create an account.`); viewAdmin();
  };
  app.querySelectorAll("[data-uninvite]").forEach(b => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.uninvite} from the invite list?`)) return;
    const { error } = await sb.from("invites").delete().eq("email", b.dataset.uninvite);
    if (error) return fail(error);
    toast("Removed."); viewAdmin();
  });

  app.querySelectorAll("[data-set]").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("claims").update({ status: b.dataset.status }).eq("id", b.dataset.set);
    if (error) return fail(error);
    toast(`Claim ${b.dataset.status}.`); viewAdmin();
  });
  app.querySelectorAll("[data-rq-approve]").forEach(b => b.onclick = async () => {
    const id = b.dataset.rqApprove;
    b.disabled = true;
    const { error } = await sb.rpc("approve_role_request", {
      p_id: Number(id),
      p_label: document.getElementById(`rql-${id}`).value.trim(),
      p_first_team_size: Number(document.getElementById(`rqs-${id}`).value) || 4,
    });
    if (error) { b.disabled = false; return fail(error); }
    toast("Role created and assigned."); viewAdmin();
  });
  app.querySelectorAll("[data-rq-reject]").forEach(b => b.onclick = async () => {
    const { error } = await sb.from("role_requests").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", b.dataset.rqReject);
    if (error) return fail(error);
    toast("Request rejected."); viewAdmin();
  });
  app.querySelectorAll("[data-unclaim]").forEach(b => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.who} from ${b.dataset.role}? Their teams for that role are removed too.`)) return;
    const { error } = await sb.from("claims").delete().eq("id", b.dataset.unclaim);
    if (error) return fail(error);
    toast("Claim removed."); viewAdmin();
  });
  app.querySelectorAll("[data-delrole]").forEach(b => b.onclick = async () => {
    const held = Number(b.dataset.held);
    if (!confirm(`Delete the role “${b.dataset.label}”?${held ? " Whoever holds it loses the role and its teams." : ""} This can’t be undone.`)) return;
    const { error } = await sb.rpc("admin_delete_role", { p_role: b.dataset.delrole });
    if (error) return fail(error);
    toast("Role deleted."); viewAdmin();
  });
  const asRole = document.getElementById("as-role");
  asRole.onchange = () => {
    document.getElementById("as-type-field").hidden = asRole.selectedOptions[0]?.dataset.needsType !== "true";
  };
  document.getElementById("assign").onsubmit = async e => {
    e.preventDefault();
    const needsType = asRole.selectedOptions[0]?.dataset.needsType === "true";
    const type = document.getElementById("as-type").value;
    if (needsType && !type) return toast("Gym and Elite Four roles need a type.", true);
    const { error } = await sb.rpc("admin_assign_role", {
      p_user: document.getElementById("as-user").value, p_role: asRole.value, p_type: needsType ? type : null,
    });
    if (error) return fail(error);
    toast("Role assigned."); viewAdmin();
  };
  document.getElementById("newrole").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.rpc("admin_create_role", {
      p_label: document.getElementById("nr-label").value.trim(),
      p_category: document.getElementById("nr-cat").value,
      p_first_team_size: Number(document.getElementById("nr-size").value) || 4,
    });
    if (error) return fail(error);
    toast("Role created."); viewAdmin();
  };
  document.getElementById("sizes").onsubmit = async e => {
    e.preventDefault();
    const changed = [...app.querySelectorAll("[data-size-for]")]
      .map(i => ({ id: i.dataset.sizeFor, size: Number(i.value) }))
      .filter(x => (roles || []).find(r => r.id === x.id)?.first_team_size !== x.size);
    if (changed.find(x => !(x.size >= 1 && x.size <= 6))) return toast("Sizes must be between 1 and 6.", true);
    for (const x of changed) {
      const { error } = await sb.from("roles").update({ first_team_size: x.size }).eq("id", x.id);
      if (error) return fail(error);
    }
    toast(changed.length ? `Saved ${changed.length} size${changed.length > 1 ? "s" : ""}.` : "Nothing changed."); viewAdmin();
  };
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
      characters: (chars || []).map(ch => ({ ...ch, name: who[ch.user_id], approved: approvedOf[ch.user_id] })),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = `elg-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
}

// ---------- router ----------
const ROUTES = { home: viewHome, roles: viewRoles, me: viewMe, ideas: () => viewIdeas("idea"), admin: viewAdmin,
  profile: param => (param ? viewProfile(param) : viewProfiles()) };
let recovering = false;
async function route() {
  if (!state.user) return viewLogin();
  if (recovering) return viewSetPassword(false);
  if (state.profile?.must_change_password) return viewSetPassword(true);
  showShell(true);
  const [, name = "home", param] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/) || [];
  const view = ROUTES[name] || viewHome;
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === name));
  app.innerHTML = `<p class="loading">Loading…</p>`;
  try { await view(param); } catch (e) { fail(e); }
}
window.addEventListener("hashchange", route);

// Never await Supabase calls directly inside this callback: supabase-js holds its auth lock while
// the callback runs, so a query there can deadlock (e.g. on token refresh). Defer the work instead.
// Events are queued and handled one at a time, so a second event never routes before the
// first one has finished loading the profile.
let authQueue = Promise.resolve();
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => { authQueue = authQueue.then(() => handleAuth(event, session)).catch(e => fail(e)); }, 0);
});
async function handleAuth(event, session) {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (event === "USER_UPDATED") recovering = false;
  const user = session?.user || null;
  if (user?.id !== state.user?.id) {
    state.user = user;
    state.profile = user ? await loadProfile() : null;
  }
  if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY") route();
}
