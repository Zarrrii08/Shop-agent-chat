import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null
};

export const action = async ({ request }) => {
  // Handle POST requests to root - return 405 Method Not Allowed
  if (request.method === "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Shop chat agent reference app</h1>
        <p className={styles.text}>
          A reference app for shop chat agent.
        </p>
      </div>
    </div>
  );
}
