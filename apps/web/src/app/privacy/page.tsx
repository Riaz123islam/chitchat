import { DocShell } from '@/components/ui';

export default function PrivacyPage() {
  return (
    <DocShell title="Privacy Policy" updated="October 2026">
      <p>
        ChitChat is designed to collect as little as possible. You can chat as a guest without
        giving us anything at all. Creating an optional account (email + password) unlocks chat
        history across your devices — and only then do we store your messages.
      </p>

      <h2>Guests (no account)</h2>
      <ul>
        <li>
          <strong>Temporary session data:</strong> when you press &ldquo;Continue as Guest&rdquo;
          we generate a random session id and a random nickname (like <em>CuriousFox42</em>). This
          lives only for your session and expires automatically.
        </li>
        <li>
          <strong>Persistent guest id:</strong> your browser keeps a random guest id in its cache
          (localStorage) so the service recognizes this device across visits. The server also notes
          your IP address as a secondary signal for abuse prevention — IPs alone are unreliable
          (shared mobile and hostel networks), so the cached id is what identifies the device. You
          can reset it any time by clearing this site&rsquo;s data in your browser.
        </li>
        <li>
          <strong>Guest chat history:</strong> finished conversations are saved <em>only in your
          browser&rsquo;s cache</em> (up to 50 chats). They never leave your device and are deleted
          if you clear the site&rsquo;s data.
        </li>
        <li>
          <strong>Chat metadata (not content):</strong> we log that a room existed, when it started
          and ended, and why — but <strong>never the messages themselves</strong>.
        </li>
      </ul>

      <h2>Accounts (email + password)</h2>
      <ul>
        <li>
          <strong>What we store:</strong> your email address and a securely hashed password
          (handled by our auth provider — we never see your password).
        </li>
        <li>
          <strong>Chat history:</strong> when a chat ends, its messages are saved to your account
          so you can re-read them on any device from the History page. This is the <em>only</em>
          case where message content is stored long-term.
        </li>
        <li>
          <strong>Deletion:</strong> deleting your account deletes your email and your entire chat
          history with it.
        </li>
      </ul>

      <h2>Safety &amp; moderation</h2>
      <ul>
        <li>
          <strong>Safety review buffer:</strong> while a chat is active, the most recent messages
          are held in the server&rsquo;s temporary memory (never written to disk) so our moderators
          can review reported or flagged abuse. This buffer is discarded the moment the chat ends
          (except when it becomes an account holder&rsquo;s saved history, described above).
        </li>
        <li>
          <strong>Reports and blocks:</strong> if you report or block someone, we store the session
          ids involved, the room id, the report reason, and a timestamp — again, never message
          text. This is what lets us ban repeat offenders.
        </li>
        <li>
          <strong>Technical data for abuse prevention:</strong> rate-limit counters and short-lived
          presence signals. IP addresses may appear in server logs for security purposes and are
          never shown to other users.
        </li>
      </ul>

      <h2>What we don&rsquo;t collect</h2>
      <p>
        Real names, phone numbers, addresses, precise location, contacts, photos, or social media
        accounts. Guests: no email either, and no message content ever leaves your device.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>Sessions expire after 30 minutes of inactivity and are purged.</li>
        <li>Chat rooms are deleted the moment they end.</li>
        <li>The safety review buffer is discarded when the chat ends and is never stored.</li>
        <li>Account chat history is kept until you delete your account.</li>
        <li>Reports and blocks are kept for up to 30 days for moderation, then deleted.</li>
      </ul>

      <h2>Third parties</h2>
      <p>
        Hosting providers process data on our behalf to run the service, including Supabase
        (database and authentication) and Upstash (matchmaking queue). If bot protection is
        enabled, Cloudflare Turnstile verifies you&rsquo;re human. Guest messages pass through the
        server&rsquo;s temporary memory for delivery and safety review &mdash; they are never
        written to disk or shared with third parties.
      </p>

      <h2>Your rights</h2>
      <p>
        Account holders can review their chat history on the History page and delete their account
        (and all history with it) at any time. Guests can clear this site&rsquo;s browser data to
        wipe their guest id and on-device history. If you have questions, contact details are
        listed in the Terms.
      </p>
    </DocShell>
  );
}
