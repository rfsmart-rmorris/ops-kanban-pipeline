#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline';

const app = new cdk.App();
new PipelineStack(app, 'stack-ueo-oce-kanban', {
  env: { account: '988159749686', region: 'us-east-1' },
});
