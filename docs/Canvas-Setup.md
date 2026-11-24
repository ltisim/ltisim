# Connecting LTISim to Canvas

One LTISim installation connects to one Canvas instance. You need to be a Canvas account administrator, and LTISim must already be running at its public HTTPS address (see [Self-hosting](Self-Hosting.md)).

Canvas is the only LMS this release has been tested with.

## Option 1: Registration link (recommended)

LTISim prints a one-time registration link in its server log whenever it starts with no LMS registered:

```
[setup] No LMS is registered yet. Either:
[setup]   - paste this dynamic registration URL into your LMS (Canvas, Moodle):
[setup]       https://ltisim.example.edu/lti/register?tok=...
```

The link contains a setup token. By default the token is new on every restart; set `SETUP_TOKEN` in `.env` to keep it fixed.

In Canvas:

1. Go to **Admin**, choose your root account, then **Developer Keys**.
2. Choose **+ Developer Key**, then **+ LTI Registration**, and paste the link.
3. Canvas shows a confirmation screen loaded from LTISim. Accept it.
4. Back in **Developer Keys**, switch the new key's state to **ON** and note its **client ID**.
5. Go to **Admin**, then **Settings**, then **Apps**, then **+ App**. Choose **By Client ID**, paste the client ID, and install.

Installing at the root account makes the tool available in every course.

The link stops working as soon as an LMS is registered. The registration is confirmed, and its status changes from "pending" to "verified", the first time someone launches the tool.

### What gets registered

LTISim asks Canvas for these placements:

| Placement | What it gives you |
|---|---|
| Assignment selection | When an instructor creates a Canvas assignment with submission type **External Tool**, choosing LTISim opens a picker listing their LTISim assignments |
| Link selection | The same picker when adding an external tool item to a module |
| Course navigation | An **LTISim** entry in the course menu that opens the instructor dashboard. Visible to teachers and administrators only; students never see it |
| Account navigation | An **LTISim** entry in the account admin menu that opens instance administration directly. **Not yet tested against Canvas** |

It also asks Canvas to send names and email addresses, so instructors can tell students apart.

The name shown in Canvas is `LTISim`, or the value of `TOOL_NAME` in `.env`.

## Option 2: Manual developer key

If you prefer to create the developer key yourself:

1. Start LTISim and run `npm run platform:show` in `backend/` to print the tool's URLs. They are also shown, with copy buttons, in the Instance area once an LMS is connected.
2. In Canvas, create an **LTI Key** under **Developer Keys** with those values:

   | Canvas field | LTISim value |
   |---|---|
   | Target Link URI | `https://<your address>/lti` |
   | OpenID Connect Initiation URL | `https://<your address>/lti/login` |
   | JWK Method: Public JWK URL | `https://<your address>/keys` |
   | Redirect URIs | `https://<your address>/lti` |

   Enable the Assignment and Grade Services scopes, set privacy to **Public**, and add the placements you want from the table above.
3. Turn the key on and note its client ID.
4. In LTISim's `.env`, describe your Canvas and restart:

   ```
   LMS_TYPE=canvas-cloud        # Canvas hosted by Instructure; use canvas-self if you host Canvas yourself
   LMS_URL=https://your-school.instructure.com
   LMS_CLIENT_ID=<the client ID>
   LMS_NAME=Your School
   ```

   For Canvas hosted by Instructure, including vanity domains, the issuer and endpoints are the same for every school and are filled in for you. For self-hosted Canvas they are derived from `LMS_URL`. Override them with `LMS_ISSUER`, `LMS_AUTH_ENDPOINT`, `LMS_TOKEN_ENDPOINT` and `LMS_KEYSET_URL` only if your Canvas is configured differently.
5. Install the app in Canvas by client ID, as in Option 1.

The manual path has not been exercised against Canvas in this edition; the registration link has.

## How instructors use it

1. Open **LTISim** from the course menu and build an assignment, from scratch or from a sample template.
2. In Canvas, create an assignment, set **Submission Type** to **External Tool**, choose **Find**, and pick LTISim. Select the LTISim assignment in the picker and save.
3. Students open that Canvas assignment and go straight into the session. The score returns to the same Canvas assignment's gradebook column.

## Who counts as an administrator

LTISim reads each person's role from the launch Canvas sends. Roles are matched exactly and per course:

- **Instructor in this course:** teachers, teaching assistants, course designers and course-level administrators of the course being launched. Teaching a different course grants nothing here.
- **Instance administrator:** Canvas account administrators. They see the **Instance** tab, and can manage any course they launch into even when not enrolled in it.
- **Everyone else** is treated as a student.

Canvas sub-account administrators are likely to be reported as administrators while inside their sub-account; this has not been checked. To choose instance administrators explicitly instead of trusting LMS roles, set `INSTANCE_ADMIN_ROLES=false` and list people in `INSTANCE_ADMIN_USER_IDS` or `INSTANCE_ADMIN_EMAILS` (see [Configuration](Configuration.md)).

## Changing or replacing the registration

Placements, the tool name and the privacy setting are fixed at registration time. To change them, or to connect a different Canvas:

1. On the LTISim server, run `npm run platform:reset` in `backend/`. If any courses exist it refuses unless you add `-- --force`, which **deletes all courses, assignments, sessions and grades**, because all data belongs to the registered LMS.
2. Restart LTISim; it prints a new registration link.
3. In Canvas, delete the old developer key and the installed app, then register again.

To adjust placements without losing data, edit the developer key in Canvas instead.

## Other LMSs

Registration and launch use the LTI 1.3 standard, and endpoint presets exist for Moodle (`LMS_TYPE=moodle`). Nothing other than Canvas has been tested, and the placements above are Canvas-specific.
