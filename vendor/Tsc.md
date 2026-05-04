# Clean all mocked repos

```shell
cd vendor

cd tool
pesto-run --clean
cd ..

cd library
pesto-run --clean
cd ..

cd plugin
pesto-run --clean
cd ..

cd monorepo
pesto-run --clean
cd ..
```

# Build and typecheck with tsc and tsgo

```shell
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
```

```shell
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
```

```shell
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
```

```shell
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
```
