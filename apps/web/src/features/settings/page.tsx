import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, KeyRound, Plus, Trash2, UserRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { type FormEvent, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { SettingsLayout, type SettingsSection } from "@/components/settings-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton } from "@/components/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { type Theme, setTheme, useTheme } from "@/lib/theme";
import { type AgentToken, type CreatedToken, createToken, listTokens, revokeToken } from "./api";

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const tools = [
  ["get_report", "Read a report's summary and debugger status."],
  ["list_report_events", "Page through recorded actions, console messages, and network events."],
  ["list_network_requests", "Page through recorded network requests."],
  ["get_network_request", "Read one request and its response."],
] as const;

function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative rounded-lg border bg-muted/40">
      <pre className="overflow-x-auto p-3 pr-24 font-mono text-xs leading-5 whitespace-pre-wrap break-all">{text}</pre>
      <div className="absolute top-2 right-2"><CopyButton text={text} label={label} /></div>
    </div>
  );
}

type SectionId = "general" | "agents";
const sections: SettingsSection<SectionId>[] = [
  { id: "general", label: "General", Icon: UserRound },
  { id: "agents", label: "Agents & MCP", Icon: Bot },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>("general");
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken>();
  const [revoking, setRevoking] = useState<AgentToken>();
  const [expiry, setExpiry] = useState("90");

  const tokensKey = ["agent-tokens", token] as const;
  const tokens = useQuery({
    queryKey: tokensKey,
    queryFn: ({ signal }) => listTokens(token, signal),
    enabled: Boolean(token),
    retry: false,
  });
  const create = useMutation({
    mutationFn: ({ name, days }: { name: string; days: number | null }) => createToken(token, name, days),
    onSuccess: async (result) => {
      setCreated(result);
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: tokensKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (item: AgentToken) => revokeToken(token, item.id),
    onSuccess: async () => {
      setRevoking(undefined);
      await queryClient.invalidateQueries({ queryKey: tokensKey });
    },
  });

  const mcpUrl = `${window.location.origin}/mcp`;
  const secret = created?.token ?? "YOUR_TOKEN";
  const snippets = {
    "claude-code": `claude mcp add --transport http zapp ${mcpUrl} \\\n  --header "Authorization: Bearer ${secret}"`,
    codex: `# Add to ~/.codex/config.toml\n[mcp_servers.zapp]\nurl = "${mcpUrl}"\nbearer_token_env_var = "ZAPP_MCP_TOKEN"\n\n# Then keep the token in your environment, not in the file\nexport ZAPP_MCP_TOKEN="${secret}"`,
    cursor: JSON.stringify({ mcpServers: { zapp: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2),
    curl: `curl -s ${mcpUrl} \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (name) create.mutate({ name, days: expiry === "never" ? null : Number(expiry) });
  }

  return (
    <>
      <SettingsLayout title="Settings" sections={sections} current={section} onSelect={setSection}>
        {section === "general" && (
          <div className="grid gap-6">
            <Card>
              <CardHeader><CardTitle>Account</CardTitle><CardDescription>The account you are signed in with.</CardDescription></CardHeader>
              <CardContent>
                <Field orientation="vertical" className="max-w-sm">
                  <FieldLabel htmlFor="account-email">Email</FieldLabel>
                  <Input id="account-email" value={session?.user.email ?? ""} readOnly />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Appearance</CardTitle><CardDescription>Choose how Zapp looks on this device.</CardDescription></CardHeader>
              <CardContent>
                <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                  <SelectTrigger aria-label="Theme" className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          </div>
        )}

        {section === "agents" && (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="size-5" />Connect an agent</CardTitle>
                <CardDescription>AI agents such as Claude Code or Cursor sign in with a personal access token and act as you. They can read your reports and their debugging data. They cannot change anything.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field orientation="vertical">
                  <FieldLabel htmlFor="mcp-url">MCP endpoint</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="mcp-url" readOnly value={mcpUrl} onFocus={(event) => event.currentTarget.select()} />
                    <CopyButton text={mcpUrl} label="Copy MCP endpoint" />
                  </div>
                </Field>
                {created && (
                  <Alert>
                    <KeyRound />
                    <AlertDescription className="grid gap-2">
                      <span>Token <strong>{created.name}</strong> created. Copy it now, because it is shown only once. The snippets below now include it.</span>
                      <div className="flex gap-2">
                        <Input readOnly aria-label="New token" value={created.token} onFocus={(event) => event.currentTarget.select()} />
                        <CopyButton text={created.token} label="Copy token" />
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <Tabs defaultValue="claude-code">
                  <TabsList aria-label="Client setup">
                    <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                    <TabsTrigger value="codex">Codex</TabsTrigger>
                    <TabsTrigger value="cursor">Cursor / JSON</TabsTrigger>
                    <TabsTrigger value="curl">cURL</TabsTrigger>
                  </TabsList>
                  {(Object.keys(snippets) as (keyof typeof snippets)[]).map((key) => (
                    <TabsContent key={key} value={key} className="pt-2"><CodeBlock text={snippets[key]} label="Copy setup snippet" /></TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="grid gap-1.5">
                  <CardTitle>Personal access tokens</CardTitle>
                  <CardDescription>Each agent gets its own token, so you can revoke one without affecting the others. Tokens work on the MCP endpoint only.</CardDescription>
                </div>
                <Button onClick={() => { create.reset(); setCreating(true); }}><Plus />New token</Button>
              </CardHeader>
              <CardContent>
                {tokens.isPending && <ListSkeleton label="Loading tokens" rows={2} avatar={false} />}
                {tokens.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(tokens.error)}</AlertDescription></Alert>}
                {tokens.isSuccess && tokens.data.items.length === 0 && <EmptyState icon={KeyRound} title="No tokens yet" description="Create a token to connect an AI agent to your Zapps through MCP." />}
                <ul className="grid divide-y">
                  {tokens.data?.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{item.name}</span>
                          {item.expiresAt && Date.parse(item.expiresAt) < Date.now() && <Badge variant="destructive">Expired</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Created {date.format(new Date(item.createdAt))} · {item.lastUsedAt ? `Last used ${date.format(new Date(item.lastUsedAt))}` : "Never used"}
                          {" · "}{item.expiresAt ? `Expires ${date.format(new Date(item.expiresAt))}` : "No expiry"}
                        </span>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${item.name}`} onClick={() => { revoke.reset(); setRevoking(item); }}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>What agents can do</CardTitle><CardDescription>Every tool is read-only, and an agent only sees reports you can open.</CardDescription></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {tools.map(([name, description]) => (
                    <li key={name} className="grid gap-0.5 sm:grid-cols-[13rem_1fr] sm:gap-3">
                      <code className="font-mono text-xs">{name}</code>
                      <span className="text-muted-foreground">{description}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
      </SettingsLayout>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New personal access token</DialogTitle>
            <DialogDescription>Name it after the agent that will use it, for example “Claude Code on my laptop”.</DialogDescription>
          </DialogHeader>
          {create.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(create.error)}</AlertDescription></Alert>}
          <form className="grid gap-4" onSubmit={submit}>
            <Field orientation="vertical">
              <FieldLabel htmlFor="token-name">Name</FieldLabel>
              <Input id="token-name" name="name" maxLength={80} required autoFocus />
            </Field>
            <Field orientation="vertical">
              <FieldLabel htmlFor="token-expiry">Expires</FieldLabel>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="token-expiry" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="30">In 30 days</SelectItem>
                  <SelectItem value="90">In 90 days</SelectItem>
                  <SelectItem value="365">In 1 year</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create token</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== undefined} onOpenChange={(open) => { if (!open) setRevoking(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>Any agent using this token loses access immediately. This cannot be undone.</DialogDescription>
          </DialogHeader>
          {revoke.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(revoke.error)}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(undefined)}>Cancel</Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
