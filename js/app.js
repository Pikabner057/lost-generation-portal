// Emerald Lost Generation: Friend Portal
// Static single-page app. All access control lives in the database (RLS);
// this file only decides what to show.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SPECIES } from "./species.js";
import { ITEMS } from "./items.js";
import { ABILITIES, MOVES } from "./pokedata.js";
import { spriteUrl } from "./sprites.js";

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
const state = { user: null, profile: null, dirty: false };

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  if (isError) {
    // Errors stay until closed, so there's time to read them and find the field
    el.setAttribute("role", "alert");
    const x = document.createElement("button");
    x.type = "button"; x.className = "toast-close"; x.textContent = "Close";
    x.onclick = () => el.remove();
    el.append(" ", x);
  } else {
    document.querySelectorAll(".toast.error").forEach(t => t.remove()); // a success replaces old errors
    setTimeout(() => el.remove(), 4500);
  }
  // Above an open dialog (top layer) when there is one
  const sheet = document.getElementById("sheet");
  (sheet?.open ? sheet : document.body).appendChild(document.getElementById("toasts")).appendChild(el);
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
const STATUS_LABEL = { pending: "Needs review", approved: "Approved", rejected: "Not approved" };
function statusBadge(st) { return `<span class="badge badge-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span>`; }
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#F5FAF6" : "#08130F");
}
// The skip link can't use its #app hash (the router owns the hash), so it just moves focus
document.getElementById("skip").onclick = e => { e.preventDefault(); app.focus(); };
document.getElementById("theme-toggle").onclick = toggleTheme;
document.getElementById("theme-toggle-auth").onclick = toggleTheme;
applyThemeLabel();

// ---------- shell ----------
function showShell(signedIn) {
  document.getElementById("header").hidden = !signedIn;
  document.getElementById("theme-toggle-auth").hidden = signedIn;
  document.getElementById("nav-admin").hidden = !state.profile?.is_admin;
}
document.getElementById("logout").onclick = async () => {
  if (state.dirty && !confirm("You have unsaved changes. Log out without saving?")) return;
  state.dirty = false;
  authLog({ event: "tapped Log out", user: true });
  await sb.auth.signOut(); location.hash = "";
};

async function loadProfile() {
  const { data, error } = await sb.from("profiles").select("*").eq("id", state.user.id).single();
  if (error) { fail(error); return null; }
  return data;
}

// ---------- pictures ----------
// Phone photos are often 3-8 MB (and sometimes HEIC). Shrink them in the browser before uploading,
// so any normal photo works and uploads stay small.
async function shrinkImage(file, maxSide, keepAlpha) {
  const heic = /hei[cf]/i.test(file.type + file.name);
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) {
    throw new Error(heic ? "This photo is in HEIC format, which the browser can’t read. Take a screenshot of it and upload that, or set the camera to save as JPG."
                         : "Couldn’t read that picture. Try a different one (PNG, JPG or WebP).");
  }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * s)); canvas.height = Math.max(1, Math.round(bmp.height * s));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const toBlob = (type, q) => new Promise(r => canvas.toBlob(r, type, q));
  let blob = await toBlob("image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(keepAlpha ? "image/png" : "image/jpeg", 0.88); // Safari can't make WebP
  if (!blob) throw new Error("Couldn’t prepare that picture. Try a different one.");
  return blob;
}
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
// Show the chosen picture right away, so it's clear it was picked and still needs Save
function previewOnPick(input, box) {
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) { box.innerHTML = ""; return; }
    const url = URL.createObjectURL(file);
    box.innerHTML = `<img src="${url}" alt="Picture you picked"><p class="hint">Picked. Tap Save to upload it.</p>`;
    const img = box.querySelector("img");
    img.onerror = () => img.remove(); // e.g. HEIC: the browser can't show it (Save explains why)
  });
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
    ${authLogHtml()}
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
      ${firstTime ? `<div class="field"><label for="dname">Display name</label><input id="dname" maxlength="24" autocomplete="nickname" required value="${esc(state.profile?.display_name)}"></div>` : ""}
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
      ${mine.length ? mine.map(c => `<p>${esc(roleLabel[c.role_id])} ${typeChip(c.poke_type)} ${statusBadge(c.status)}</p>`).join("")
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
  const isAdmin = state.profile.is_admin;  // the admin can hold any number of roles (schema v7)
  const canClaim = isAdmin || mine.length < MAX_ROLES;
  const second = !isAdmin && mine.length === 1;
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
    <p class="muted">${isAdmin ? `You hold ${mine.length} role${mine.length === 1 ? "" : "s"}. As admin you can claim as many as you need.`
      : mine.length === 0 ? "Claim a slot. Gym Leaders and the Elite Four each pick a type nobody else has."
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
        <b>${esc(q.role_name)}</b> ${statusBadge(q.status)}
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
      ${r.story ? `<p><b>Story:</b> ${esc(r.story)}</p>` : ""}
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
    <p><b>Backstory:</b> ${esc(s.backstory || "—")}</p>
    <p><b>Personality:</b> ${esc(s.personality || "—")}</p>
    <p><b>Style:</b> ${esc(s.look_note || "—")}</p>
    ${perRole || `<p><b>Team (old format):</b> ${teamSummary(s.team)}</p>`}
    <p><b>Notes:</b> ${esc(s.notes || "—")}</p>`;
}
async function openSubmission(userId, name) {
  const sheet = document.getElementById("sheet");
  sheet.innerHTML = `<p class="loading">Loading…</p>`;
  sheet.setAttribute("aria-labelledby", "sheet-title");
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
    <div class="panel-head"><h2 class="card-title" id="sheet-title">${esc(name)}’s submission</h2>
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
// Close on backdrop taps only (a tap on the dialog's own padding also targets #sheet)
document.getElementById("sheet").addEventListener("click", e => {
  if (e.target.id !== "sheet") return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
});

// ---------- trainer card (My Character profile tab + Crew) ----------
const ROLE_ABOUT = {
  gym: "A Gym Leader: a type specialist who guards one of Hoenn's badges. Every trainer has to beat you to move on.",
  elite4: "A member of the Elite Four: one of the strongest trainers in Hoenn, waiting at the end of Victory Road.",
  aqua: "Part of Team Aqua's leadership. You shape what the team does and how far it's willing to go.",
  magma: "Part of Team Magma's leadership. You shape what the team does and how far it's willing to go.",
  professor: "The region's Pokémon professor: the one who hands new trainers their first partner.",
  champion: "The Champion: the last battle of the main story.",
  custom: "A role made for you from your own idea.",
};
function roleAbout(role) { return role?.description || ROLE_ABOUT[role?.category] || ""; }
// A stable, fun ID number for the card footer
function trainerNo(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 10000;
  return String(h).padStart(4, "0");
}
function spriteImg(species, cls = "poke-sprite", size = 56) {
  const url = spriteUrl(species);
  return url ? `<img class="${cls}" src="${esc(url)}" width="${size}" height="${size}" alt="" loading="lazy">`
             : `<span class="${cls} is-empty" aria-hidden="true"></span>`;
}
function teamStripHtml(team) {
  const mons = (team || []).filter(m => m.species);
  if (!mons.length) return "";
  return `<div class="team-strip" translate="no">${mons.map(m => `<span class="team-strip-mon">${spriteImg(m.species, "poke-sprite", 40)}<span>${esc(m.nickname || m.species)}</span></span>`).join("")}</div>`;
}
// card: { userId, name, player, title, roles: [{label, type}], art, avatar, team, compact }
function trainerCardHtml(card) {
  const type = card.roles.find(r => r.type)?.type;
  const initial = esc((card.name || card.player || "?").trim().slice(0, 1).toUpperCase());
  const art = card.art || card.avatar;
  return `<article class="trainer-card${card.compact ? " is-compact" : ""}"${type ? ` data-type="${esc(type)}"` : ""}>
    <div class="trainer-card-art">${art ? `<img src="${esc(art)}" alt="${esc(card.name || card.player)}">`
                                        : `<span class="trainer-card-placeholder" aria-hidden="true">${initial}</span>`}</div>
    <div class="trainer-card-body">
      ${card.title ? `<p class="trainer-card-title">${esc(card.title)}</p>` : ""}
      <h2 class="trainer-card-name">${esc(card.name || "No name yet")}</h2>
      <p class="trainer-card-player">Player: ${esc(card.player)}</p>
      ${card.roles.length ? `<ul class="trainer-card-roles" translate="no">${card.roles.map(r => `<li>${esc(r.label)} ${typeChip(r.type)}</li>`).join("")}</ul>`
                          : `<p class="muted">No role yet</p>`}
      ${card.compact ? "" : teamStripHtml(card.team)}
    </div>
    <p class="trainer-card-id">ELG No. ${trainerNo(card.userId)}</p>
  </article>`;
}

// ---------- crew ----------
async function viewProfiles() {
  const [{ data: profiles }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("profiles").select("id,display_name,avatar_path,approved_titles,approved_character_name").order("display_name"),
    sb.from("claims").select("user_id,role_id,poke_type,status,created_at").neq("status", "rejected").order("created_at"),
    sb.from("roles").select("id,label"),
  ]);
  const roleLabel = Object.fromEntries((roles || []).map(r => [r.id, r.label]));
  const claimsOf = {};
  (claims || []).forEach(c => (claimsOf[c.user_id] ||= []).push(c));
  const crew = await Promise.all((profiles || []).map(p => sb.rpc("crew_character", { p_user: p.id }).then(r => r.data)));
  const [avatarUrls, lookUrls] = await Promise.all([
    signedUrls("avatars", (profiles || []).map(p => p.avatar_path)),
    signedUrls("looks", crew.map(c => c?.look_image)),
  ]);
  app.innerHTML = `
    <h1 class="page-title">The Crew</h1>
    <div class="profile-grid">
      ${(profiles || []).map((p, i) => {
        const cs = claimsOf[p.id] || [], c = crew[i], titles = p.approved_titles || {};
        return `<a class="crew-link" href="#/profile/${p.id}">${trainerCardHtml({
          userId: p.id, compact: true, player: p.display_name,
          name: c?.character_name || p.approved_character_name,
          title: titles[cs[0]?.role_id] || "",
          roles: cs.map(x => ({ label: roleLabel[x.role_id] || x.role_id, type: x.poke_type })),
          art: lookUrls[c?.look_image], avatar: avatarUrls[p.avatar_path],
        })}</a>`;
      }).join("")}
    </div>`;
}

function storyBlock(title, text) {
  return text ? `<section class="crew-story card stack"><h2 class="card-title">${esc(title)}</h2><p class="story-text">${esc(text)}</p></section>` : "";
}

async function viewProfile(id) {
  const isMe = id === state.user.id, canSeeTeams = isMe || state.profile.is_admin;
  const [{ data: p, error }, { data: claims }, { data: roles }, { data: c }] = await Promise.all([
    sb.from("profiles").select("id,display_name,avatar_path,approved_titles,approved_character_name,approved_at").eq("id", id).single(),
    sb.from("claims").select("role_id,poke_type,status").eq("user_id", id).neq("status", "rejected").order("created_at"),
    sb.from("roles").select("*"),
    sb.rpc("crew_character", { p_user: id }),
  ]);
  if (error) return fail(error);
  const roleById = Object.fromEntries((roles || []).map(r => [r.id, r]));
  // Teams are private: only the owner and the admin can read characters (enforced by RLS)
  let ch = null;
  if (canSeeTeams) ({ data: ch } = await sb.from("characters").select("roles").eq("user_id", id).maybeSingle());
  const [avatarUrls, lookUrls] = await Promise.all([signedUrls("avatars", [p.avatar_path]), signedUrls("looks", [c?.look_image])]);
  const titles = p.approved_titles || {};
  const cr = c?.roles || {};
  const firstRole = (claims || [])[0]?.role_id;
  app.innerHTML = `
    <p><a href="#/profile" class="back-link">‹ The Crew</a></p>
    ${trainerCardHtml({
      userId: p.id, player: p.display_name,
      name: c?.character_name || p.approved_character_name,
      title: titles[firstRole] || cr[firstRole]?.title || "",
      roles: (claims || []).map(x => ({ label: roleById[x.role_id]?.label || x.role_id, type: x.poke_type })),
      art: lookUrls[c?.look_image], avatar: avatarUrls[p.avatar_path],
      team: canSeeTeams ? (ch?.roles?.[firstRole]?.rematch_team || []) : null,
    })}
    ${isMe ? `<p><a class="btn btn-ghost btn-small" href="#/me/profile">Edit my profile</a></p>` : ""}
    ${c ? `${storyBlock("Backstory", c.backstory)}${storyBlock("Personality", c.personality)}${storyBlock("Style", c.look_note)}
      ${(claims || []).map(x => {
        const r = cr[x.role_id] || {}, d = r.dialogue || {}, role = roleById[x.role_id];
        const lines = [d.intro && `<p><b>Before the battle:</b> “${esc(d.intro)}”</p>`, d.defeat && `<p><b>When they lose:</b> “${esc(d.defeat)}”</p>`,
          ...(d.extra || []).map(l => `<p>“${esc(l)}”</p>`)].filter(Boolean).join("");
        if (!r.title && !r.story && !lines && !r.signature_move?.name) return "";
        return `<section class="crew-story card stack">
          <h2 class="card-title">${esc(role?.label || x.role_id)} ${typeChip(x.poke_type)}</h2>
          ${r.title ? `<p class="profile-title">${esc(r.title)}</p>` : ""}
          ${r.story ? `<p class="story-text">${esc(r.story)}</p>` : ""}
          ${r.signature_move?.name ? `<p><b>Signature move:</b> ${esc(r.signature_move.name)}${r.signature_move.description ? `: ${esc(r.signature_move.description)}` : ""}</p>` : ""}
          ${lines}
        </section>`;
      }).join("")}`
      : `<p class="muted">${esc(p.display_name)}’s character shows up here once Abner approves it.</p>`}
    ${canSeeTeams ? `
    <div class="profile-private card stack">
      <p class="private-note">Only ${isMe ? "you" : esc(p.display_name)} and Abner can see this</p>
      <h2 class="card-title">Teams</h2>
      ${Object.keys(ch?.roles || {}).length ? Object.entries(ch.roles).map(([k, r]) => `<div class="stack"><h3 class="team-section-title">${esc(roleById[k]?.label || k)}</h3>
        <p><b>First battle</b></p>${teamStripHtml(r.first_team) || `<p class="muted">Empty</p>`}
        <p><b>Rematch</b></p>${teamStripHtml(r.rematch_team) || `<p class="muted">Empty</p>`}
        <details><summary>Full details</summary><p>${teamSummary(r.first_team)}</p><p>${teamSummary(r.rematch_team)}</p></details></div>`).join("")
        : `<p class="muted">No teams yet.</p>`}
    </div>` : ""}`;
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
    <div class="poke-slot-head">${spriteImg(m.species).replace(/^<(img|span) /, `<$1 id="spr-${id}" `)}<span class="poke-slot-num">${i + 1}</span></div>
    <div class="field"><label for="sp-${id}">Pokémon</label><input id="sp-${id}" list="species" value="${esc(m.species)}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" data-species-for="${id}"></div>
    <div class="field"><label for="nn-${id}">Nickname</label><input id="nn-${id}" maxlength="12" value="${esc(m.nickname)}" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label for="it-${id}">Held item</label><input id="it-${id}" list="items" value="${esc(m.item)}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"></div>
    <div class="field"><label for="ab-${id}">Ability</label><select id="ab-${id}" data-ability-for="${id}">${abilityOptions(m.species, m.ability)}</select></div>
    <div class="moves-grid">${[0, 1, 2, 3].map(j => `<div class="field"><label for="mv-${id}-${j}">Move ${j + 1}</label>
      <input id="mv-${id}-${j}" list="moves" value="${esc((m.moves || [])[j])}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"></div>`).join("")}</div>
    <div class="field"><label for="gm-${id}">Gimmick</label><select id="gm-${id}" data-gimmick="${id}">
      ${GIMMICKS.map(x => `<option${x === g ? " selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="field tera-field" id="tf-${id}" ${g === "Tera" ? "" : "hidden"}><label for="tt-${id}">Tera type</label><select id="tt-${id}">
      <option value="">Pick…</option>${TERA_TYPES.map(t => `<option${t === m.tera ? " selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="field"><label for="no-${id}">Note (strategy, EVs, nature…)</label><input id="no-${id}" maxlength="120" value="${esc(m.note)}" autocomplete="off"></div>
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

// Unsaved-changes guard: forms call watchForm(); route() asks before leaving.
function watchForm(form, onSave) {
  state.dirty = false;
  const bar = document.createElement("div");
  bar.className = "unsaved-bar"; bar.setAttribute("role", "status"); bar.hidden = true;
  bar.innerHTML = `You have unsaved changes <button class="btn btn-primary btn-small" type="button">Save</button>`;
  bar.querySelector("button").onclick = () => form.requestSubmit();
  form.after(bar);
  const mark = () => { state.dirty = true; bar.hidden = false; };
  form.addEventListener("input", mark);
  form.addEventListener("change", mark);
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const barBtn = bar.querySelector("button");
    btn.disabled = barBtn.disabled = true; btn.dataset.label ||= btn.textContent; btn.textContent = "Saving…";
    try {
      if (await onSave() !== false) { state.dirty = false; toast("Saved!"); route(); }
    } catch (err) { fail(err); }
    finally { btn.disabled = barBtn.disabled = false; btn.textContent = btn.dataset.label; }
  };
}
window.addEventListener("beforeunload", e => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function loadMe() {
  const [{ data: ch }, { data: claims }, { data: roles }] = await Promise.all([
    sb.from("characters").select("*").eq("user_id", state.user.id).maybeSingle(),
    sb.from("claims").select("*").eq("user_id", state.user.id).neq("status", "rejected").order("created_at"),
    sb.from("roles").select("*"),
  ]);
  const c = ch || { character_name: "", look_note: "", look_image: null, notes: "", backstory: "", personality: "", roles: {} };
  const roleById = Object.fromEntries((roles || []).map(r => [r.id, r]));
  const myRoles = (claims || []).filter(cl => roleById[cl.role_id])
    .map(cl => ({ claim: cl, role: roleById[cl.role_id], data: (c.roles || {})[cl.role_id] || {} }));
  return { ch, c, myRoles };
}
// Saves the whole character row; `patch` replaces only what one tab edits.
async function saveCharacter(c, myRoles, patch) {
  const roles = {};
  for (const { role, data } of myRoles) roles[role.id] = { ...data, ...(patch.roles?.[role.id] || {}) };
  const { error } = await sb.from("characters").upsert({
    user_id: state.user.id,
    character_name: c.character_name, look_note: c.look_note, look_image: c.look_image, notes: c.notes,
    backstory: c.backstory || "", personality: c.personality || "",
    ...patch, roles,
  });
  if (error) { fail(error); return false; }
}
async function uploadLook(input) {
  const file = input.files[0];
  if (!file) return undefined;
  let blob;
  try { blob = await shrinkImage(file, 1600, true); } catch (e) { toast(e.message, true); return false; }
  const path = `${state.user.id}/look-${Date.now()}.${IMG_EXT[blob.type]}`;
  const { error } = await sb.storage.from("looks").upload(path, blob, { contentType: blob.type });
  if (error) { fail(error); return false; }
  return path; // old images are kept so the version history still shows them
}

function meTabs(active) {
  const tab = (id, label) => `<a class="subtab" href="#/me/${id}"${active === id ? ` aria-current="page"` : ""}>${label}</a>`;
  return `<h1 class="page-title">My Character</h1>
    <nav class="subtabs" aria-label="My Character sections">${tab("profile", "Profile")}${tab("character", "Character")}${tab("teams", "Teams")}</nav>`;
}

async function viewMe(tab = "profile", sub) {
  if (tab === "role") return viewMeRole(sub);
  if (tab === "character") return viewMeCharacter();
  if (tab === "teams") return viewMeTeams();
  return viewMeProfile();
}

async function viewMeProfile() {
  const { ch, c, myRoles } = await loadMe();
  const prof = state.profile;
  const changedSinceApproval = prof.approved_at && ch && new Date(ch.updated_at) > new Date(prof.approved_at);
  const [lookUrl, avatarUrls] = await Promise.all([signedLook(c.look_image), signedUrls("avatars", [prof.avatar_path])]);
  const first = myRoles[0];
  app.innerHTML = `${meTabs("profile")}
  ${trainerCardHtml({
    userId: state.user.id, player: prof.display_name, name: c.character_name,
    title: first?.data.title || "", art: lookUrl, avatar: avatarUrls[prof.avatar_path],
    roles: myRoles.map(({ claim, role }) => ({ label: role.label, type: claim.poke_type })),
    team: first?.data.rematch_team?.length ? first.data.rematch_team : first?.data.first_team,
  })}
  <div class="card stack"><h2 class="card-title">Approval</h2>
    ${prof.approved_at
      ? `<p><span class="approved-mark">Approved ${esc(fmtDate(prof.approved_at))}</span> ${esc(prof.approved_character_name || "")}</p>
         ${changedSinceApproval ? `<p class="hint">You changed things since then. Abner will review the new version.</p>` : ""}`
      : `<p class="muted">Not approved yet. Abner reviews every version you save. Your character shows up for the crew once it’s approved.</p>`}
    ${ch ? `<p class="meta-date">Last saved ${esc(fmtDateTime(ch.updated_at))}</p>` : ""}
  </div>
  <form id="profform" class="card stack"><h2 class="card-title">Your profile</h2>
    <div class="field"><label for="pname">Username</label><input id="pname" name="nickname" maxlength="24" autocomplete="nickname" spellcheck="false" value="${esc(prof.display_name)}"></div>
    <div class="field"><label for="pavatar">Profile picture</label><input id="pavatar" type="file" accept="image/*">
      <div class="pick-preview" id="pavatar-preview"></div></div>
    <div class="field"><label for="notes">Notes for Abner</label><textarea id="notes" rows="3" maxlength="1000">${esc(c.notes)}</textarea>
      <p class="hint">Only Abner sees these.</p></div>
    <button class="btn btn-primary" type="submit">Save profile</button>
  </form>`;
  previewOnPick(document.getElementById("pavatar"), document.getElementById("pavatar-preview"));
  watchForm(document.getElementById("profform"), async () => {
    const patch = { display_name: document.getElementById("pname").value.trim() || prof.display_name };
    const file = document.getElementById("pavatar").files[0];
    if (file) {
      let blob;
      try { blob = await shrinkImage(file, 512, false); } catch (e) { toast(e.message, true); return false; }
      const path = `${state.user.id}/avatar-${Date.now()}.${IMG_EXT[blob.type]}`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, blob, { contentType: blob.type });
      if (upErr) { fail(upErr); return false; }
      if (prof.avatar_path) await sb.storage.from("avatars").remove([prof.avatar_path]);
      patch.avatar_path = path;
    }
    const { error } = await sb.from("profiles").update(patch).eq("id", state.user.id);
    if (error) { fail(error); return false; }
    state.profile = { ...state.profile, ...patch };
    const notes = document.getElementById("notes").value.trim();
    if (notes !== c.notes) return saveCharacter(c, myRoles, { notes });
  });
}

async function viewMeCharacter() {
  const { c, myRoles } = await loadMe();
  const lookUrl = await signedLook(c.look_image);
  app.innerHTML = `${meTabs("character")}
  <form id="charform" class="stack">
    <div class="card stack"><h2 class="card-title">Who are you in the game?</h2>
      <div class="field"><label for="cname">Character name</label><input id="cname" maxlength="12" autocomplete="off" value="${esc(c.character_name)}">
        <p class="hint">Same character in every role. GBA names fit 12 characters.</p></div>
      <div class="field"><label for="backstory">Backstory</label><textarea id="backstory" rows="5" maxlength="3000" placeholder="Where they come from, what happened to them, why they battle…">${esc(c.backstory)}</textarea></div>
      <div class="field"><label for="personality">Personality</label><textarea id="personality" rows="3" maxlength="1500" placeholder="Calm, cocky, kind, chaotic…">${esc(c.personality)}</textarea></div>
    </div>
    <div class="card stack"><h2 class="card-title">Style</h2>
      <div class="field"><label for="looknote">Describe your character</label><textarea id="looknote" rows="5" maxlength="2000" placeholder="Describe your character in detail: hair, eyes, outfit, colors, accessories…">${esc(c.look_note)}</textarea></div>
      <div class="look-preview">${lookUrl ? `<img src="${esc(lookUrl)}" alt="Your reference image">` : ""}</div>
      <div class="field"><label for="lookfile">Reference image for Abner (optional)</label><input id="lookfile" type="file" accept="image/*">
        <div class="pick-preview" id="lookfile-preview"></div>
        <p class="hint">If you have a picture of how they should look, send it here.</p></div>
    </div>
    <button class="btn btn-primary" type="submit">Save character</button>
  </form>
  <div class="card stack"><h2 class="card-title">My roles</h2>
    ${myRoles.length ? `<div class="role-list">${myRoles.map(({ claim, role }) => `<a class="role-link" href="#/me/role/${esc(role.id)}">
        <span class="role-link-label">${esc(role.label)}</span>${typeChip(claim.poke_type)}
        ${statusBadge(claim.status)}<span class="role-link-chevron" aria-hidden="true">›</span></a>`).join("")}</div>
      <p class="hint">Open a role for its story, title and battle lines. Teams are in the Teams tab.</p>`
      : `<p class="muted">No role yet.</p><a class="btn btn-gold" href="#/roles">Pick a role</a>`}
  </div>`;
  previewOnPick(document.getElementById("lookfile"), document.getElementById("lookfile-preview"));
  watchForm(document.getElementById("charform"), async () => {
    const look = await uploadLook(document.getElementById("lookfile"));
    if (look === false) return false;
    return saveCharacter(c, myRoles, {
      character_name: document.getElementById("cname").value.trim(),
      backstory: document.getElementById("backstory").value.trim(),
      personality: document.getElementById("personality").value.trim(),
      look_note: document.getElementById("looknote").value.trim(),
      ...(look ? { look_image: look } : {}),
    });
  });
}

async function viewMeRole(roleId) {
  const { c, myRoles } = await loadMe();
  const entry = myRoles.find(x => x.role.id === roleId);
  if (!entry) { location.hash = "#/me/character"; return; }
  const { claim, role, data } = entry, d = data.dialogue || {}, k = role.id;
  app.innerHTML = `${meTabs("character")}
  <form id="roleform" class="role-detail card stack">
    <a class="back-link" href="#/me/character">‹ Character</a>
    <div class="role-entry-head"><h2 class="card-title">${esc(role.label)}</h2> ${typeChip(claim.poke_type)}
      ${statusBadge(claim.status)}</div>
    ${roleAbout(role) ? `<div class="role-desc"><strong>About this role</strong><p>${esc(roleAbout(role))}</p></div>` : ""}
    <div class="field"><label for="title-${k}">Title for this role</label><input id="title-${k}" maxlength="24" autocomplete="off" value="${esc(data.title)}" placeholder="${claim.poke_type ? `The ${esc(claim.poke_type)} Master` : "Shadow Agent"}">
      <p class="hint">Shown before your name, like a trainer class.</p></div>
    <div class="field"><label for="story-${k}">Your story in this role</label><textarea id="story-${k}" rows="5" maxlength="3000" placeholder="How did you get this role? What do you want? How do you meet the player?">${esc(data.story)}</textarea></div>
    ${role.category === "gym" ? `<div class="signature-move stack">
      <h3 class="signature-title">Signature move</h3>
      <p class="hint">Gym Leaders only. Pick a move or invent your own.</p>
      <div class="field"><label for="sig-${k}">Move</label><input id="sig-${k}" list="moves" maxlength="40" value="${esc(data.signature_move?.name)}" autocomplete="off"></div>
      <div class="field"><label for="sigd-${k}">What it does</label><textarea id="sigd-${k}" rows="2" maxlength="300">${esc(data.signature_move?.description)}</textarea></div>
    </div>` : ""}
    <h3 class="team-section-title">What you say in battle</h3>
    <div class="field"><label for="di-${k}">Before the battle</label><textarea id="di-${k}" rows="2" maxlength="300">${esc(d.intro)}</textarea></div>
    <div class="field"><label for="dd-${k}">When you lose</label><textarea id="dd-${k}" rows="2" maxlength="300">${esc(d.defeat)}</textarea></div>
    <div class="field"><label for="dx-${k}">Extra lines (one per line)</label><textarea id="dx-${k}" rows="3" maxlength="800">${esc((d.extra || []).join("\n"))}</textarea></div>
    <button class="btn btn-primary" type="submit">Save role</button>
  </form>
  ${role.category === "gym" ? `<datalist id="moves">${MOVES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>` : ""}`;
  watchForm(document.getElementById("roleform"), () => saveCharacter(c, myRoles, { roles: { [k]: {
    title: document.getElementById(`title-${k}`).value.trim(),
    story: document.getElementById(`story-${k}`).value.trim(),
    ...(role.category === "gym" ? { signature_move: {
      name: document.getElementById(`sig-${k}`).value.trim(),
      description: document.getElementById(`sigd-${k}`).value.trim(),
    } } : {}),
    dialogue: {
      intro: document.getElementById(`di-${k}`).value.trim(),
      defeat: document.getElementById(`dd-${k}`).value.trim(),
      extra: document.getElementById(`dx-${k}`).value.split("\n").map(s => s.trim()).filter(Boolean),
    },
  } } }));
}

// Find the team field a validation message is about, mark it and bring it into view
function markBadField(msg) {
  document.querySelectorAll("#teamform [aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  const quoted = msg.match(/“(.+?)”/)?.[1], ability = msg.match(/can’t have (.+)\.$/)?.[1];
  const want = quoted || ability;
  if (!want) return;
  const el = [...document.querySelectorAll("#teamform input, #teamform select")].find(x => x.value.trim() === want);
  if (!el) return;
  el.setAttribute("aria-invalid", "true");
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}
async function viewMeTeams() {
  const { c, myRoles } = await loadMe();
  const section = ({ claim, role, data }) => {
    const k = role.id;
    const first = Array.from({ length: role.first_team_size }, (_, i) => (data.first_team || [])[i] || {});
    const rematch = Array.from({ length: 6 }, (_, i) => (data.rematch_team || [])[i] || {});
    return `<section class="role-entry card stack">
      <div class="role-entry-head"><h2 class="card-title">${esc(role.label)}</h2> ${typeChip(claim.poke_type)}</div>
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
    </section>`;
  };
  app.innerHTML = `${meTabs("teams")}
  <p class="muted">Only you and Abner can see your teams, so nobody can prep against you.</p>
  <datalist id="species">${SPECIES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  <datalist id="items">${ITEMS.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  <datalist id="moves">${MOVES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
  ${myRoles.length ? `<form id="teamform" class="stack" translate="no">${myRoles.map(section).join("")}
      <button class="btn btn-primary" type="submit">Save teams</button></form>`
    : `<div class="card"><p class="muted">Claim a role first, then build its teams here.</p><a class="btn btn-gold" href="#/roles">Pick a role</a></div>`}`;
  if (!myRoles.length) return;
  app.querySelectorAll("[data-species-for]").forEach(inp => inp.addEventListener("change", () => {
    const id = inp.dataset.speciesFor, name = inp.value.trim();
    const sel = document.getElementById(`ab-${id}`);
    sel.innerHTML = abilityOptions(name, sel.value);
    document.getElementById(`spr-${id}`).outerHTML = spriteImg(SPECIES_SET.has(name) ? name : "").replace("<img ", `<img id="spr-${id}" `).replace("<span ", `<span id="spr-${id}" `);
  }));
  app.querySelectorAll("[data-gimmick]").forEach(sel => sel.addEventListener("change", () => {
    document.getElementById(`tf-${sel.dataset.gimmick}`).hidden = sel.value !== "Tera";
  }));
  watchForm(document.getElementById("teamform"), () => {
    const roles = {};
    for (const { role } of myRoles) {
      const k = role.id;
      const first = readTeam(`${k}-f`, role.first_team_size), rematch = readTeam(`${k}-r`, 6);
      const problem = teamProblem(first, `${role.label} first battle`) || teamProblem(rematch, `${role.label} rematch`);
      if (problem) { toast(problem, true); markBadField(problem); return false; }
      roles[k] = { first_team: first, rematch_team: rematch };
    }
    return saveCharacter(c, myRoles, { roles });
  });
}

// ---------- ideas (private: the author and Abner) ----------
const IDEA_CATS = { character: "Character", story: "Story", design: "Design", other: "Other" };
const IDEA_STATUS = { new: "New", considering: "Considering", used: "Used", not_now: "Not now" };
async function viewIdeas() {
  const isAdmin = state.profile.is_admin;
  const [{ data: posts }, { data: profiles }] = await Promise.all([
    sb.from("posts").select("*").eq("kind", "idea").order("created_at", { ascending: false }),
    sb.from("profiles").select("id,display_name"),
  ]);
  const who = names(profiles);
  app.innerHTML = `
  <h1 class="page-title">Idea Box</h1>
  <div class="idea-intro card"><p class="post-body">Submit any idea for the game: new characters, story or plot, designs, anything else. Only Abner sees what you send, and you can follow what happens to your own ideas here. Every idea is welcome.</p></div>
  <form id="newidea" class="card stack">
    <fieldset class="cat-picker"><legend>Category</legend>
      ${Object.entries(IDEA_CATS).map(([v, l], i) => `<label class="cat-option"><input type="radio" name="cat" value="${v}"${i === 0 ? " checked" : ""}>${l}</label>`).join("")}
    </fieldset>
    <div class="field"><label for="body">Your idea</label><textarea id="body" rows="4" maxlength="2000" required></textarea></div>
    <button class="btn btn-gold" type="submit">Submit</button>
  </form>
  <h2 class="card-title">${isAdmin ? "All ideas" : "Your ideas"}</h2>
  <div class="stack">
    ${(posts || []).map(p => `
      <article class="idea-card card">
        <div class="post-meta"><span class="idea-cat" data-cat="${esc(p.category)}">${esc(IDEA_CATS[p.category] || p.category)}</span>
          <span class="idea-status" data-status="${esc(p.status)}">${esc(IDEA_STATUS[p.status] || p.status)}</span>
          <span>${isAdmin ? `${esc(who[p.user_id])} · ` : ""}${fmtDate(p.created_at)}</span></div>
        <p class="post-body">${esc(p.body)}</p>
        ${isAdmin ? `<div class="idea-admin"><label class="hint" for="st-${p.id}">Status</label>
            <select class="idea-status-select" id="st-${p.id}" data-status-for="${p.id}">${Object.entries(IDEA_STATUS).map(([v, l]) => `<option value="${v}"${v === p.status ? " selected" : ""}>${l}</option>`).join("")}</select>
            <button class="btn btn-ghost btn-small" type="button" data-del="${p.id}">Delete</button></div>`
          : p.user_id === state.user.id && p.status === "new" ? `<button class="btn btn-ghost btn-small" type="button" data-del="${p.id}">Delete</button>` : ""}
      </article>`).join("") || `<p class="muted">${isAdmin ? "No ideas yet." : "You haven’t sent any ideas yet."}</p>`}
  </div>`;
  document.getElementById("newidea").onsubmit = async e => {
    e.preventDefault();
    const body = document.getElementById("body").value.trim();
    if (!body) return;
    const btn = e.submitter; btn.disabled = true; btn.textContent = "Submitting…";
    const category = new FormData(e.target).get("cat") || "other";
    const { error } = await sb.from("posts").insert({ kind: "idea", body, category });
    if (error) { btn.disabled = false; btn.textContent = "Submit"; return fail(error); }
    toast("Idea submitted. Thanks!"); viewIdeas();
  };
  app.querySelectorAll("[data-status-for]").forEach(sel => sel.onchange = async () => {
    const { error } = await sb.from("posts").update({ status: sel.value }).eq("id", sel.dataset.statusFor);
    if (error) return fail(error);
    toast("Status updated."); viewIdeas();
  });
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this idea?")) return;
    const { error } = await sb.from("posts").delete().eq("id", b.dataset.del);
    if (error) return fail(error);
    viewIdeas();
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
        <td>${statusBadge(c.status)}</td>
        <td class="admin-actions">
          ${c.status !== "approved" ? `<button class="btn btn-primary btn-small" data-set="${c.id}" data-status="approved">Approve</button>` : ""}
          ${c.status !== "rejected" ? `<button class="btn btn-danger btn-small" data-set="${c.id}" data-status="rejected">Reject</button>` : ""}
          <button class="btn btn-ghost btn-small" data-unclaim="${c.id}" data-who="${esc(who[c.user_id])}" data-role="${esc(roleLabel[c.role_id])}">Remove</button>
        </td></tr>`).join("") || `<tr><td colspan="5" class="muted">No claims yet.</td></tr>`}</tbody>
    </table></div>
  </div>
  <div class="request-card card stack"><h2 class="card-title">Custom role requests</h2>
    ${(requests || []).length ? `<ul class="request-list">${requests.map(q => `<li class="request-item stack">
      <p><b>${esc(who[q.user_id])}</b> wants <b>${esc(q.role_name)}</b> ${statusBadge(q.status)}</p>
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
const ROUTES = { home: viewHome, roles: viewRoles, me: viewMe, ideas: viewIdeas, admin: viewAdmin,
  profile: param => (param ? viewProfile(param) : viewProfiles()) };
let recovering = false;
let currentHash = location.hash;
async function route() {
  if (!state.user) return viewLogin();
  if (recovering) return viewSetPassword(false);
  if (state.profile?.must_change_password) return viewSetPassword(true);
  // Leaving a form with unsaved changes: ask first, and stay (restoring the link) if they cancel
  if (state.dirty && location.hash !== currentHash) {
    if (!confirm("You have unsaved changes. Leave without saving?")) { history.replaceState(null, "", currentHash); return; }
  }
  state.dirty = false;
  currentHash = location.hash;
  showShell(true);
  const [, name = "home", param, param2] = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?(?:\/([\w-]+))?/) || [];
  const view = ROUTES[name] || viewHome;
  document.querySelectorAll("#nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.route === name);
    if (a.dataset.route === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  app.innerHTML = `<p class="loading">Loading…</p>`;
  try { await view(param, param2); } catch (e) { fail(e); }
  // Tell screen readers the page changed: new title, focus on the page heading
  const h1 = app.querySelector("h1");
  document.title = (h1 ? h1.textContent.trim() + " · " : "") + "Emerald Lost Generation";
  if (h1 && document.activeElement?.closest?.("#nav, .subtabs, .back-link, .crew-link, a")) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
}
window.addEventListener("hashchange", route);

// Never await Supabase calls directly inside this callback: supabase-js holds its auth lock while
// the callback runs, so a query there can deadlock (e.g. on token refresh). Defer the work instead.
// Events are queued and handled one at a time, so a second event never routes before the
// first one has finished loading the profile.
let authQueue = Promise.resolve();
// Small local log of login events, shown on the login screen after a surprise logout,
// so a screenshot tells us what happened. If it's missing, the phone wiped the site's storage.
function authLog(entry) {
  try {
    const log = JSON.parse(localStorage.getItem("elg-authlog") || "[]");
    log.push({ t: new Date().toISOString(), ...entry });
    localStorage.setItem("elg-authlog", JSON.stringify(log.slice(-12)));
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => authLog({ event: "page " + document.visibilityState, user: !!state.user }));
window.addEventListener("pageshow", e => authLog({ event: e.persisted ? "page restored" : "page loaded", user: !!state.user }));
sb.auth.onAuthStateChange((event, session) => {
  authLog({ event, user: !!session, exp: session?.expires_at || null });
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
function authLogHtml() {
  let log = [];
  try { log = JSON.parse(localStorage.getItem("elg-authlog") || "[]"); } catch (e) {}
  if (!log.some(l => l.user)) return "";   // never logged in here (or storage was wiped): nothing to show
  return `<details class="auth-log"><summary>Logged out by surprise? Tap here and send Abner a screenshot</summary>
    <ol>${log.map(l => `<li>${esc(new Date(l.t).toLocaleString())}: ${esc(l.event)}${l.user ? " (logged in)" : ""}</li>`).join("")}</ol>
    <p class="hint">${esc(navigator.userAgent)} · storage ${(() => { try { localStorage.setItem("elg-t", "1"); localStorage.removeItem("elg-t"); return "ok"; } catch (e) { return "blocked"; } })()}</p></details>`;
}
