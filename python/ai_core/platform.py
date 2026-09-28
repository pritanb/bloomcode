"""Open the existing restricted platform MCP connection."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import tomllib
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@asynccontextmanager
async def platform_session(config_file: Path, data_dir: Path | None = None):
    config = tomllib.loads(config_file.read_text())["mcp_servers"]["bloomcode"]
    env = dict(config["env"])
    if data_dir is not None:
        env["DATA_DIR"] = str(data_dir)
    server = StdioServerParameters(
        command=config["command"], args=config["args"],
        cwd=config["cwd"], env=env,
    )
    async with asyncio.timeout(30):
        async with stdio_client(server) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                yield session

