# Clean all mocked repos

```shell
cd vendor

cd tool
npm run clean
cd ..

cd library
npm run clean
cd ..

cd plugin
npm run clean
cd ..

cd monorepo
npm run clean
cd ..

cd ..
```

# Reset all mocked repos

```shell
cd vendor

cd tool
npm install --no-fund --no-audit
npm run build
npm run format
cd ..

cd library
npm install --no-fund --no-audit
npm run build
npm run format
cd ..

cd plugin
npm install --no-fund --no-audit --save-exact matterbridge
npm install --no-fund --no-audit
npm run build
npm run format
cd ..

cd monorepo
npm install --no-fund --no-audit
npm run build
npm run format
cd ..

cd ..
```

# Build and typecheck with tsc and tsgo

```shell
npm install --no-fund --no-audit --global @typescript/native-preview oxlint oxlint-tsgolint oxfmt
```

```shell
cd vendor
cd tool
tsgo -build tsconfig.build.json
tsgo -build tsconfig.build.production.json
tsgo -build tsconfig.json
npx prettier --write .
npx eslint .
tsgo -build tsconfig.build.json --clean
tsgo -build tsconfig.build.production.json --clean
tsgo -build tsconfig.json --clean
npx tsc -build tsconfig.build.json
npx tsc -build tsconfig.build.production.json
npx tsc -build tsconfig.json
npx tsc -build tsconfig.build.json --clean
npx tsc -build tsconfig.build.production.json --clean
npx tsc -build tsconfig.json --clean
cd ..
cd ..
```

```shell
cd vendor
cd library
tsgo -build tsconfig.build.json
tsgo -build tsconfig.build.production.json
tsgo -build tsconfig.json
npx prettier --write .
npx eslint .
tsgo -build tsconfig.build.json --clean
tsgo -build tsconfig.build.production.json --clean
tsgo -build tsconfig.json --clean
npx tsc -build tsconfig.build.json
npx tsc -build tsconfig.build.production.json
npx tsc -build tsconfig.json
npx tsc -build tsconfig.build.json --clean
npx tsc -build tsconfig.build.production.json --clean
npx tsc -build tsconfig.json --clean
cd ..
cd ..
```

```shell
cd vendor
cd plugin
tsgo -build tsconfig.build.json
tsgo -build tsconfig.build.production.json
tsgo -build tsconfig.json
npx prettier --write .
npx eslint .
tsgo -build tsconfig.build.json --clean
tsgo -build tsconfig.build.production.json --clean
tsgo -build tsconfig.json --clean
npx tsc -build tsconfig.build.json
npx tsc -build tsconfig.build.production.json
npx tsc -build tsconfig.json
npx tsc -build tsconfig.build.json --clean
npx tsc -build tsconfig.build.production.json --clean
npx tsc -build tsconfig.json --clean
cd ..
cd ..
```

```shell
cd vendor
cd monorepo
tsgo -build tsconfig.build.json
tsgo -build tsconfig.build.production.json
tsgo -build tsconfig.json
npx prettier --write .
npx eslint .
tsgo -build tsconfig.build.json --clean
tsgo -build tsconfig.build.production.json --clean
tsgo -build tsconfig.json --clean
npx tsc -build tsconfig.build.json
npx tsc -build tsconfig.build.production.json
npx tsc -build tsconfig.json
npx tsc -build tsconfig.build.json --clean
npx tsc -build tsconfig.build.production.json --clean
npx tsc -build tsconfig.json --clean
cd ..
cd ..
```
