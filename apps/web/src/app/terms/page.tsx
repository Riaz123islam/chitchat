import { DocShell } from '@/components/ui';

export default function TermsPage() {
  return (
    <DocShell title="Terms of Service" updated="September 2026">
      <p>
        By using ChitChat you agree to these terms. If you don&rsquo;t agree, please don&rsquo;t
        use the service. ChitChat is a personal project run as a free service with no warranties.
      </p>

      <h2>1. The service</h2>
      <p>
        ChitChat provides anonymous, real-time 1-to-1 text chat with random strangers. There are
        no accounts. Conversations are ephemeral: messages are relayed live and never stored.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old (or the age of majority where you live) to use ChitChat.
        By using the service you confirm you meet this requirement.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use ChitChat for any of the following:</p>
      <ul>
        <li>Harassment, threats, or bullying</li>
        <li>Scams, phishing, fraud, or spam</li>
        <li>Illegal activity of any kind</li>
        <li>Sharing or soliciting personal information (yours or anyone else&rsquo;s)</li>
        <li>Sexual exploitation, including any sexual content involving minors</li>
        <li>Hate speech or abuse</li>
        <li>Attempting to disrupt the service: flooding, automated bots, or circumventing rate limits and bans</li>
      </ul>
      <p>
        We may rate-limit, block, or ban sessions that violate these terms, with or without notice.
      </p>

      <h2>4. Content</h2>
      <p>
        You are responsible for what you send. We don&rsquo;t pre-screen conversations, but we
        provide reporting and blocking tools, automated filters, and rate limits. Reported sessions
        may be reviewed using report metadata (never message content, which we don&rsquo;t store).
      </p>

      <h2>5. No warranties</h2>
      <p>
        ChitChat is provided &ldquo;as is&rdquo;, without warranties of any kind. The service runs
        on free-tier infrastructure and may be slow, unavailable, or discontinued at any time. We
        are not liable for anything strangers say to you, or for any loss arising from your use of
        the service.
      </p>

      <h2>6. Changes</h2>
      <p>
        These terms may change as the project evolves. Continued use after changes means you accept
        the new terms. The &ldquo;last updated&rdquo; date above shows the current version.
      </p>

      <h2>7. Contact</h2>
      <p>
        For questions about these terms or the service, open an issue on the project&rsquo;s GitHub
        repository (linked in the README).
      </p>
    </DocShell>
  );
}
