import { headers } from "next/headers";
import { relationStore } from "~/data/store";

export default function Page() {
  return (
    <div className="mx-auto max-w-[780px] p-4 my-8 grid gap-4">
      <div className="whitespace-pre font-mono">{bannerText}</div>
      <p>
        This small federated server app is a demo of Fedify. The only one thing
        it does is to accept follow requests.
      </p>
      <p>
        You can follow this demo app via the below handle:{" "}
        <code className="pre px-2 py-1 bg-gray-100 rounded-md select-all">
          @demo@{headers().get("host")}
        </code>
      </p>
      {relationStore.size === 0 ? (
        <p>
          No followers yet. Try to add a follower using{" "}
          <a
            href="https://activitypub.academy/"
            target="_blank"
            className="text-blue-600"
          >
            ActivityPub.Academy
          </a>
          .
        </p>
      ) : (
        <>
          <p>This account has the below {relationStore.size} followers:</p>
          <ul className="grid gap-1">
            {Array.from(relationStore.values()).map((address) => (
              <li
                key={address}
                className="pre px-2 py-1 bg-gray-100 rounded-md"
              >
                {address}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const bannerText = `
_____        _ _  __         ____
|  ___|__  __| (_)/ _|_   _  |  _ \\  ___ _ __ ___   ___
| |_ / _ \\/ _\` | | |_| | | | | | | |/ _ \\ '_ \` _ \\ / _ \\
|  _|  __/ (_| | |  _| |_| | | |_| |  __/ | | | | | (_) |
|_|  \\___|\\__,_|_|_|  \\__, | |____/ \\___|_| |_| |_|\\___/
                      |___/
`;
