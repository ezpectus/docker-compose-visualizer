# GitHub Launch Checklist

## 1. Before the first push

- [ ] Delete leftover `README.md.tmp`
- [ ] Run `npm run build` — must pass with no errors
- [ ] Test both launchers: `start.bat` (Windows), `start.sh` (WSL/mac if available)
- [ ] Manual smoke test: open file → edit YAML → drag connection → delete edge → download

## 2. Repository setup

```bash
git init
git add .
git commit -m "feat: initial release — bidirectional docker-compose visual editor"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/docker-compose-visualizer.git
git push -u origin main
```

- [ ] Repo name: `docker-compose-visualizer`
- [ ] Description: "Bidirectional visual editor for docker-compose.yml — edit YAML or drag the graph, both stay in sync"
- [ ] Topics: `docker`, `docker-compose`, `visualization`, `react-flow`, `devops`, `yaml`, `developer-tools`

## 3. The one thing that decides everything: media

- [ ] Record a GIF (ScreenToGif / LICEcap, ≤10 MB): typing YAML → graph updates → drag edge → YAML updates
- [ ] Save as `docs/demo.gif`, embed at the top of README:
  `![Demo](docs/demo.gif)`
- [ ] Take 1–2 high-res screenshots of a big compose file for social posts

## 4. Free hosting (live demo link doubles the stars)

Vercel / Netlify / GitHub Pages — it's a static Vite build:

```bash
npm run build   # output in dist/
```

- [ ] Add the live demo link to the README header and repo About field

## 5. Promotion

- [ ] Post GIF to r/devops, r/selfhosted, r/docker (best: Tue–Thu, morning US time)
- [ ] Title idea: "I built a two-way visual editor for docker-compose — drag an arrow, the YAML rewrites itself"
- [ ] Answer every comment in the first 24h — the algorithm rewards it
- [ ] Optional: Hacker News "Show HN", X/Twitter thread with the GIF

## 6. Nice-to-have after launch

- [ ] GitHub Actions CI (build on PR)
- [ ] Export graph as PNG
- [ ] Node inspector panel
- [ ] Issue templates + CONTRIBUTING.md if traffic appears
