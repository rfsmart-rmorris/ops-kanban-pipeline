import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { Construct } from 'constructs';

export class PipelineStack extends cdk.Stack {
  readonly NUGET_USERNAME: string = 'noreply@github.com';
  readonly NUGET_REPO: string = 'https://nuget.pkg.github.com/RF-SMART-for-OracleCloud/index.json';
  readonly NUGET_TOKEN: string = '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';
  readonly IMAGE_NAME: string = 'kanban-jobrunner';
  readonly REMOTE_TAG: string = 'latest';
  readonly REPOSITORY: string = 'ecr-ueo-oce-kanban';

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Define the account id
    const AWS_ACCOUNT_ID = cdk.Stack.of(this).account;
    const AWS_REGION = cdk.Stack.of(this).region; // us-east-1

    // ECR Repository
    const repository = new ecr.Repository(this, 'KanbanJobRunnerRepository', {
      repositoryName: this.IMAGE_NAME,
      imageScanOnPush: true,
    });

    repository.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'pipe-ueo-oce-kanban-jobrunner',
      restartExecutionOnUpdate: true,
    });

    // Define the source stage
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'RF-SMART-for-OracleCloud',
      repo: 'oc-kanban-pipeline',
      connectionArn:
        'arn:aws:codestar-connections:us-east-1:988159749686:connection/8b952def-0a0c-456f-85ad-3b2f2a5760cc',
      output: sourceOutput,
      branch: 'main',
    });
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Existing VPC
    // const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
    //   vpcId: 'vpc-0ef451f55c3392a63',
    // });

    // const securityGroup = ec2.SecurityGroup.fromLookupById(this, 'SecurityGroup', 'sg-0fd9e8b43aec73091');

    // Build Project
    const project = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: 'proj-ueo-oce-kanban-jobrunner',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged: true, // This is needed for Docker builds
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'echo installing dependencies ...',
              'apt-get update -y',
              'apt-get install -y docker.io',
              'docker --version',
              'dotnet --version',
            ],
          },
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin ${repository.repositoryUri}`,
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'echo "FROM public.ecr.aws/lambda/dotnet:6 AS base" > Dockerfile',
              'echo "WORKDIR /app" >> Dockerfile',
              'echo "FROM public.ecr.aws/lambda/dotnet:6 AS build" >> Dockerfile',
              'echo "ARG NUGET_REPOSITORY" >> Dockerfile',
              'echo "ARG NUGET_TOKEN" >> Dockerfile',
              'echo "ARG NUGET_USERNAME" >> Dockerfile',
              'echo "WORKDIR /src" >> Dockerfile',
              'echo "COPY ["Rfsmart.Kanban.JobRunner/Rfsmart.Kanban.JobRunner.csproj", "Rfsmart.Kanban.JobRunner/"" >> Dockerfile',
              'echo "RUN dotnet nuget add source $NUGET_REPOSITORY --name rfsmart/oraclecloud --password $NUGET_TOKEN --username $NUGET_USERNAME --store-password-in-clear-text" >> Dockerfile',
              'echo "RUN dotnet restore "Rfsmart.Kanban.JobRunner/Rfsmart.Kanban.JobRunner.csproj"" >> Dockerfile',
              'echo "COPY . ." >> Dockerfile',
              'echo "WORKDIR "/src/Rfsmart.Kanban.JobRunner" >> Dockerfile',
              'echo "RUN dotnet build "Rfsmart.Kanban.JobRunner.csproj" -c Release -o /app/build" >> Dockerfile',
              'echo "FROM build AS publish" >> Dockerfile',
              'echo "RUN dotnet publish "Rfsmart.Kanban.JobRunner.csproj" -c Release -o /app/publish /p:UseAppHost=false" >> Dockerfile',
              'echo "FROM base AS final" >> Dockerfile',
              'echo "WORKDIR /app" >> Dockerfile',
              'echo "COPY --from=publish /app/publish ." >> Dockerfile',
              'echo "EXPOSE 80" >> Dockerfile',
              'echo "EXPOSE 443" >> Dockerfile',
              'echo "ENTRYPOINT ["dotnet", "Rfsmart.Kanban.JobRunner.dll"]" >> Dockerfile',
              'echo Building the Docker image...',
              'docker build -t $IMAGE_NAME .',
              `docker tag ${this.IMAGE_NAME}:$REMOTE_TAG $REPOSITORY_URI:$REMOTE_TAG`,
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
              'echo Pushing the Docker image...',
              `docker push $REPOSITORY_URI:$REMOTE_TAG`,
            ],
          },
        },
        artifacts: {
          files: ['**/*'],
          'discard-paths': 'yes',
        },
      }),
      environmentVariables: {
        REPOSITORY_URI: {
          value: repository.repositoryUri,
        },
        IMAGE_NAME: {
          value: this.IMAGE_NAME,
        },
        REMOTE_TAG: {
          value: this.REMOTE_TAG,
        },
      },
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Build',
      project: project,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction],
    });

    // Define the deploy stage
    const lambdaFunction = new lambda.DockerImageFunction(this, 'LambdaFunction', {
      functionName: 'stg-ueo-oce-func-kanban-jobrunner',
      code: lambda.DockerImageCode.fromEcr(repository, { tag: this.REMOTE_TAG }),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      tracing: lambda.Tracing.ACTIVE,
    });

    const deployAction = new codepipeline_actions.LambdaInvokeAction({
      actionName: 'Deploy',
      lambda: lambdaFunction,
      inputs: [sourceOutput],
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction],
    });

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: lambdaFunction.functionArn,
    });
  }
}
