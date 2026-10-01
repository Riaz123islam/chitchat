import { DocShell } from '@/components/ui';

export default function SafetyPage() {
  return (
    <DocShell title="Safety & Community Guidelines" updated="September 2026">
      <p>
        ChitChat is a place for spontaneous, anonymous conversation. Anonymity is a privilege —
        these guidelines keep it safe for everyone. Violating them can get you reported, blocked,
        or temporarily banned from matchmaking.
      </p>

      <h2>Things you must never do on ChitChat</h2>
      <ul>
        <li><strong>Harassment or bullying:</strong> no insults, intimidation, or targeting anyone.</li>
        <li><strong>Threats:</strong> no threats of violence or harm, even as a &ldquo;joke&rdquo;.</li>
        <li><strong>Scams and phishing:</strong> no fake links, impersonation, or attempts to steal information or money.</li>
        <li><strong>Spam:</strong> no flooding, advertising, or repeated unwanted messages.</li>
        <li><strong>Illegal activity:</strong> no discussion or coordination of anything illegal.</li>
        <li><strong>Sharing personal information:</strong> don&rsquo;t ask for — or share — real names, addresses, phone numbers, photos, or social media accounts. Yours or anyone else&rsquo;s.</li>
        <li><strong>Sexual exploitation:</strong> no sexual content involving minors, no non-consensual sexual content, no pressuring anyone.</li>
        <li><strong>Abuse:</strong> no hate speech or content that demeans people for who they are.</li>
      </ul>

      <h2>How we protect you</h2>
      <ul>
        <li><strong>Anonymous by design:</strong> there are no accounts and no profiles. Your session id and nickname are temporary.</li>
        <li><strong>No message history:</strong> chat messages are relayed in real time and never stored.</li>
        <li><strong>Rate limits &amp; filters:</strong> flooding, spam patterns and common profanity are blocked automatically.</li>
        <li><strong>Report:</strong> flag a conversation for review. Reports store metadata only — never message text.</li>
        <li><strong>Block:</strong> instantly end a chat and never be matched with that person again.</li>
        <li><strong>Next:</strong> leave any conversation at any time, no explanation needed.</li>
      </ul>

      <h2>Staying safe as a user</h2>
      <ul>
        <li>Treat every stranger as a stranger. Anonymity cuts both ways.</li>
        <li>Never share personal information, photos, or links to your social accounts.</li>
        <li>Don&rsquo;t click links strangers send you.</li>
        <li>If someone makes you uncomfortable: report, block, and hit Next.</li>
        <li>If you believe a crime has been committed, contact your local authorities.</li>
      </ul>

      <h2>For parents and guardians</h2>
      <p>
        ChitChat connects users with random strangers and is intended for adults. If you are under
        18, please don&rsquo;t use ChitChat. If you&rsquo;re a parent, talk to your kids about the
        risks of anonymous chat apps — just as you would about talking to strangers anywhere else.
      </p>
    </DocShell>
  );
}
