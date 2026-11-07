import { headers } from "next/headers";
import { relationStore } from "@/data/store";
import Link from "next/link";

export default async function Page() {
  const forwardedHost = (await headers()).get("x-forwarded-host");
  const host = (await headers()).get("host");
  return (
    <div className="mx-auto max-w-[780px] p-4 my-8 grid gap-4">
      <img
        src="/fedify-next-logo.svg"
        alt="@fedify/next Logo"
        className="w-32 h-32 m-auto"
      />
      <div className="whitespace-pre font-mono leading-tight">
        {bannerText} with{" "}
        <Link href="https://nextjs.org/">
          <img
            src="/next.svg"
            alt="Next.js"
            className="inline-block w-24 dark:invert"
          />
        </Link>
      </div>
      <p>
        This small federated server app is a demo of Fedify. The only one thing
        it does is to accept follow requests.
      </p>
      <p>
        You can follow this demo app via the below handle:{" "}
        <code className="pre px-2 py-1 text-black bg-gray-100 rounded-md select-all">
          @demo@{forwardedHost ?? host}
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
          <ul className="flex flex-col items-stretch gap-1 w-max">
            {Array.from(relationStore.keys()).map((address) => (
              <li
                key={address}
                className="pre px-2 py-1 flex-1 text-black bg-gray-100 rounded-md"
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
|__|     |_______||_______/ |__| |__|        |__|     `;
