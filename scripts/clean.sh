#!/bin/bash

echo "Cleaning build directories..."

# Remove dist directories in packages
rm -rf packages/core/dist
rm -rf packages/service/dist
rm -rf packages/simulator/dist
rm -rf packages/ui/dist
rm -rf packages/service/static
rm -f packages/ui/vite.config.ts.timestamp-*.mjs
rm -f packages/simulator/tsconfig.tsbuildinfo
rm -f packages/service/tsconfig.tsbuildinfo
rm -f packages/core/tsconfig.tsbuildinfo

echo "Build directories cleaned."