import { headers } from "next/headers";
import { relationStore } from "~/data/store";

export default async function Page() {
  return (
    <div className="mx-auto max-w-[780px] p-4 my-8 grid gap-4">
      <div className="whitespace-pre font-mono leading-tight">{bannerText}</div>
      <p>
        This small federated server app is a demo of Fedify. The only one thing
        it does is to accept follow requests.
      </p>
      <p>
        You can follow this demo app via the below handle:{" "}
        <code className="pre px-2 py-1 bg-gray-100 rounded-md select-all">
          @demo@{(await headers()).get("host")}
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
 _______  _______  _______   __   ___________    ____ 
|   ____||   ____||       \\ |  | |   ____\\   \\  /   / 
|  |__   |  |__   |  .--.  ||  | |  |__   \\   \\/   /  
|   __|  |   __|  |  |  |  ||  | |   __|   \\_    _/   
|  |     |  |____ |  '--'  ||  | |  |        |  |     
|__|     |_______||_______/ |__| |__|        |__|     
`;
