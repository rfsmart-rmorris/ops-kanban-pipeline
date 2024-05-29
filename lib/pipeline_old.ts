import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import { Construct } from 'constructs';

export class PipelineStack extends cdk.Stack {
  readonly NUGET_USERNAME: string = 'noreply@github.com';
  readonly NUGET_REPO: string = 'https://nuget.pkg.github.com/RF-SMART-for-OracleCloud/index.json';
  readonly NUGET_TOKEN: string = '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';
  readonly IMAGE_NAME: string = 'kanban-jobrunner';
  readonly REMOTE_TAG: string = 'latest';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const region: string = props?.env?.region || cdk.Stack.of(this).region;

    const pipelineArtifact = new codepipeline.Artifact();
    const sourceArtifact = new codepipeline.Artifact();

    new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'RF-SMART-for-OracleCloud',
      repo: 'oc-kanban',
      connectionArn:
        'arn:aws:codestar-connections:us-east-1:988159749686:connection/8b952def-0a0c-456f-85ad-3b2f2a5760cc', // Created using the AWS console
      output: sourceArtifact,
      branch: 'develop',
    });

    // Create the ECR Repository
    const repository = ecr.Repository.fromRepositoryArn(
      this,
      'ecr-ueo-oce-kanban-job-runner',
      'arn:aws:ecr:us-east-1:988159749686:repository/oc-kanban/kanban-jobrunner'
    );

    // Create the CodeBuild project
    const project = new codebuild.PipelineProject(this, 'Build', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-version': {
              dotnet: '6.0',
            },
            commands: ['aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY'],
          },
          build: {
            commands: [
              `docker build --build-arg NUGET_REPOSITORY=${this.NUGET_REPO} --build-arg NUGET_TOKEN=${this.NUGET_TOKEN} --build-arg NUGET_USERNAME=${this.NUGET_USERNAME} -t ${this.IMAGE_NAME} -f ./Rfsmart.Kanban.JobRunner/Dockerfile .`,
              `docker tag ${this.IMAGE_NAME} $ECR_REGISTRY/$REPO_NAME:$TAG`,
              `docker push $ECR_REGISTRY/$REPO_NAME:$TAG`,
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
    });

    repository.grantPullPush(project);
    const repositoryUri = repository.repositoryUri;

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'tskd-ueo-oce-kanban', {
      cpu: 256,
      memoryLimitMiB: 2048,
      executionRole: executionRole,
    });

    taskDefinition.addContainer('cnt-ueo-oce-kanban-workflow', {
      image: ecs.ContainerImage.fromEcrRepository(repository),
      portMappings: [
        { containerPort: 80, hostPort: 80 },
        { containerPort: 443, hostPort: 443 },
      ],
    });

    const vpc = ec2.Vpc.fromLookup(this, 'stg-VPC', {
      vpcId: 'vpc-0ef451f55c3392a63',
    });

    const cluster = new ecs.Cluster(this, 'oc-kanban-cluster', {
      clusterName: 'oc-kanban-cluster',
      vpc: vpc,
    });

    const service = new ecs.FargateService(this, 'frgt-ueo-oce-kanban-cluster', {
      serviceName: 'frgt-ueo-oce-kanban-cluster',
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 2,
      assignPublicIp: true,
    });

    repository.grantPull(taskDefinition.taskRole);

    // Create the CodePipeline
    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'ppl-ueo-oce-oc-kanban',
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: 'GitHub_Source',
              owner: 'RF-SMART-for-OracleCloud',
              repo: 'oc-kanban',
              connectionArn:
                'arn:aws:codestar-connections:us-east-1:988159749686:connection/8b952def-0a0c-456f-85ad-3b2f2a5760cc', // Created using the AWS console
              output: sourceArtifact,
              branch: 'develop',
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Build',
              project: project,
              input: sourceArtifact,
              outputs: [pipelineArtifact],
              environmentVariables: {
                ECR_REGISTRY: { value: repository.repositoryUri },
                REPO_NAME: { value: this.IMAGE_NAME },
                TAG: { value: 'latest' },
              },
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.EcsDeployAction({
              actionName: 'Deploy',
              service: service,
              input: pipelineArtifact,
            }),
          ],
        },
      ],
    });
  }
}
