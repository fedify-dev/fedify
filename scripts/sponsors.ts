interface Member {
  readonly MemberId: number;
  readonly createdAt: string;
  readonly type: "USER" | "ORGANIZATION";
  readonly role: "ADMIN" | "HOST" | "FOLLOWER" | "BACKER";
  readonly tier?: string;
  readonly isActive: boolean;
  readonly totalAmountDonated: number;
  readonly lastTransactionAt: string;
  readonly lastTransactionAmount: number;
  readonly profile: string;
  readonly name: string;
  readonly company: string | null;
  readonly description: string | null;
  readonly image: string | null;
  readonly email?: string | null;
  readonly newsletterOptIn?: null;
  readonly twitter: string | null;
  readonly github: string | null;
  readonly website: string | null;
}

type MemberList = readonly Member[];

async function fetchMembers(): Promise<MemberList> {
  const res = await fetch("https://opencollective.com/fedify/members/all.json");
  return res.json();
}

function compareTotalAmountDonated(a: Member, b: Member): number {
  return b.totalAmountDonated - a.totalAmountDonated;
}

function getBackers(members: MemberList): MemberList {
  return members.filter((member) =>
    member.role === "BACKER" &&
    member.tier?.toLowerCase() === "backer"
  ).toSorted(compareTotalAmountDonated);
}

function getSupporters(members: MemberList): MemberList {
  return members.filter((member) =>
    member.role === "BACKER" &&
    member.tier?.toLowerCase() === "supporter"
  ).toSorted(compareTotalAmountDonated);
}

function getSponsors(members: MemberList): MemberList {
  return members.filter((member) =>
    member.role === "BACKER" &&
    member.tier?.toLowerCase() === "sponsor"
  ).toSorted(compareTotalAmountDonated);
}

function getCorporateSponsors(members: MemberList): MemberList {
  return members.filter((member) =>
    member.role === "BACKER" &&
    member.tier?.toLowerCase() === "corporate sponsor"
  ).toSorted(compareTotalAmountDonated);
}

function getCustomDonations(members: MemberList): MemberList {
  return members.filter((member) =>
    member.role === "BACKER" &&
    member.tier === "custom donation"
  ).toSorted(compareTotalAmountDonated);
}

function escape(string: string): string {
  return string.replace(/[\\*_()\[\]]/g, (m) => `\\${m}`);
}

function escapeTableCell(string: string | null): string {
  return string == null
    ? ""
    : escape(string).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function getLink(member: Member): string {
  return member.website ?? member.github ?? member.twitter ?? member.profile;
}

function getAvatar(member: Member, size: number): string {
  const name = member.profile.substring(member.profile.lastIndexOf("/") + 1);
  return `https://images.opencollective.com/${name}/avatar/${size}.png`;
}

function listNames(members: MemberList): string {
  return members.map((member) => member.name).join(", ");
}

function listNamesAndLinks(members: MemberList): string {
  return members
    .map((member) => `- [${escape(member.name)}](${getLink(member)})`)
    .join("\n");
}

function listNamesAndAvatars(members: MemberList, size: number): string {
  return members
    .map((member) =>
      `- [<img src="${
        getAvatar(member, size * 2)
      }" width="${size}" height="${size}"> ${escape(member.name)}](${
        getLink(member)
      })`
    )
    .join("\n");
}

function tableCorporateSponsors(members: MemberList, size: number): string {
  return [
    "| Avatar | Name | Description |",
    "| ------ | ---- | ----------- |",
    ...members.map((member) =>
      `| <img src="${
        getAvatar(member, size * 2)
      }" width="${size}" height="${size}"> | [${
        escapeTableCell(member.name)
      }](${getLink(member)}) | ${escapeTableCell(member.description)} |`
    ),
  ].join("\n");
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function heading(level: HeadingLevel, text: string): string {
  if (level < 3) {
    const char = level === 1 ? "=" : "-";
    return `${text}\n${char.repeat(text.length)}`;
  }
  return `${"#".repeat(level)} ${text}`;
}

function render(members: MemberList, headingLevel: HeadingLevel): string {
  const sections: string[] = [];
  const corporateSponsors = getCorporateSponsors(members);
  if (corporateSponsors.length > 0) {
    sections.push(heading(headingLevel, "Corporate sponsors"));
    sections.push(tableCorporateSponsors(corporateSponsors, 64));
  }
  const sponsors = getSponsors(members);
  if (sponsors.length > 0) {
    sections.push(heading(headingLevel, "Sponsors"));
    sections.push(listNamesAndAvatars(sponsors, 32));
  }
  const supporters = getSupporters(members);
  if (supporters.length > 0) {
    sections.push(heading(headingLevel, "Supporters"));
    sections.push(listNamesAndLinks(supporters));
  }
  const backers = getBackers(members);
  if (backers.length > 0) {
    sections.push(heading(headingLevel, "Backers"));
    sections.push(listNames(backers));
  }
  const customDonations = getCustomDonations(members);
  if (customDonations.length > 0) {
    sections.push(heading(headingLevel, "One-time donations"));
    sections.push(listNames(customDonations));
  }
  return sections.join("\n\n");
}

const PATTERN =
  /(<!--\s*DO\s+NOT\s+EDIT\s*\(\s*h([123456])\s*\)(?:\s*:\s*.*?)?\s*-->).*?(<!--\s*\/DO\s+NOT\s+EDIT\s*-->)/gs;

function interpolate(text: string, members: MemberList): string {
  return text.replaceAll(PATTERN, (entire, start, level, end) => {
    const headingLevel = parseInt(level);
    if (
      headingLevel !== 1 && headingLevel !== 2 && headingLevel !== 3 &&
      headingLevel !== 4 && headingLevel !== 5 && headingLevel !== 6
    ) {
      return entire;
    }
    return `${start}\n\n${render(members, headingLevel)}\n\n${end}`;
  });
}

async function main(): Promise<void> {
  const members = await fetchMembers();
  for (const f of Deno.args) {
    const content = await Deno.readTextFile(f);
    const newContent = interpolate(content, members);
    await Deno.writeTextFile(f, newContent, { create: false });
  }
}

if (import.meta.main) {
  await main();
}
