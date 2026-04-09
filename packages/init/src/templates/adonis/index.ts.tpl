import server from "./app.ts";
import "./logging.ts";

server.listen(3333, () => {
  console.log("Server started at http://localhost:3333");
});
