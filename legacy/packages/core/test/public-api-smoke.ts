import type {
  ArchiveCommit,
  ArchiveManifest,
  ArchiveReadResult,
  ArchiveRepository,
  ArchiveTransaction,
  CanonDocuments,
  CommandAvailability,
  CoreFileSystem,
  DayloomRuntime,
  IdGenerator,
  InitSubmission,
  MachineInput,
  PreparedSession,
  PreparedSubmission,
  RuntimeClock,
  RuntimeCommand,
  RuntimeErrorCode,
  RuntimeEvent,
  RuntimeInput,
  RuntimeResult,
  RuntimeSnapshot,
  SessionEvent,
  SessionKind,
  SessionPreparationContext,
  SessionSnapshot,
  SessionStatus,
  StateMachine,
  TransitionResult,
  WorldPhase,
  WorldSnapshot,
} from '../dist/index';

const command: RuntimeCommand = 'init';
const phase: WorldPhase = 'uninitialized';
const sessionKind: SessionKind = 'init';
const sessionStatus: SessionStatus = 'waiting-input';
const errorCode: RuntimeErrorCode = 'ARCHIVE_CONFLICT';

function acceptTargetContracts(input: {
  archiveCommit: ArchiveCommit;
  archiveManifest: ArchiveManifest;
  archiveReadResult: ArchiveReadResult;
  archiveRepository: ArchiveRepository;
  archiveTransaction: ArchiveTransaction;
  canon: CanonDocuments;
  fileSystem: CoreFileSystem;
  ids: IdGenerator;
  initSubmission: InitSubmission;
  preparedSession: PreparedSession;
  preparedSubmission: PreparedSubmission;
  sessionPreparation: SessionPreparationContext;
  clock: RuntimeClock;
  machine: StateMachine;
  machineInput: MachineInput;
  transition: TransitionResult;
}): void {
  void input;
}

function readPublicRuntime(runtime: DayloomRuntime): {
  snapshot: RuntimeSnapshot;
  commands: CommandAvailability[];
} {
  return {
    snapshot: runtime.getSnapshot(),
    commands: runtime.getAvailableCommands(),
  };
}

function acceptPublicTypes(input: {
  command: RuntimeCommand;
  event: RuntimeEvent;
  input: RuntimeInput;
  result: RuntimeResult;
  sessionEvent: SessionEvent;
  sessionSnapshot: SessionSnapshot;
  worldSnapshot: WorldSnapshot;
}): void {
  void input;
}

void command;
void phase;
void sessionKind;
void sessionStatus;
void errorCode;
void acceptTargetContracts;
void readPublicRuntime;
void acceptPublicTypes;
