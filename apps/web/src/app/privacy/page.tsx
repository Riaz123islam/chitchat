import { DocShell } from '@/components/ui';

export default function PrivacyPage() {
  return (
    <DocShell title="Privacy Policy" updated="September 2026">
      <p>
        ChitChat is designed to collect as little as possible. There are no accounts, so we never
        ask for your name, email, phone number, address, location, contacts, or social media
        accounts — and we have no use for them.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Temporary session data:</strong> when you press &ldquo;Start Chatting&rdquo; we
          generate a random session id and a random nickname (like <em>CuriousFox42</em>). This
          lives only for your session and expires automatically.
        </li>
        <li>
          <strong>Chat metadata (not content):</strong> we log that a room existed, when it started
          and ended, and why — but <strong>never the messages themselves</strong>. Messages are
          relayed in real time and then gone.
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
        Real names, emails, phone numbers, addresses, precise location, contacts, photos, social
        media accounts, or message content. If a feature ever needed more data, we&rsquo;d update
        this page first.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>Sessions expire after 30 minutes of inactivity and are purged.</li>
        <li>Chat rooms are deleted the moment they end.</li>
        <li>Reports and blocks are kept for up to 30 days for moderation, then deleted.</li>
      </ul>

      <h2>Third parties</h2>
      <p>
        Hosting providers process data on our behalf to run the service: Vercel (website), Render
        (chat server), Supabase (database), and Upstash (matchmaking queue). If bot protection is
        enabled, Cloudflare Turnstile verifies you&rsquo;re human. None of them receive your
        messages, because we never store them.
      </p>

      <h2>Your rights</h2>
      <p>
        Because there are no accounts and nothing is tied to your identity, there is nothing to
        export or correct. Leaving the site — or just closing the tab — deletes your session. If
        you have questions, contact details are listed in the Terms.
      </p>
    </DocShell>
  );
}
