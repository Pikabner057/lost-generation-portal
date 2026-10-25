# Emerald Lost Generation: Friend Portal

A small invite-only site where the Emerald Lost Generation crew claims their roles
(Gym Leader, Elite Four, Team Aqua/Magma boss, Professor), builds their team, sends
look references and dialogue, and follows the ROM hack's progress.

- Static site (GitHub Pages) + Supabase (auth, database, storage)
- No secrets in this repo: the Supabase publishable key is public by design;
  access is enforced by row-level security in the database.
