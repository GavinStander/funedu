import { users, type User, type InsertUser, schools, type School, type InsertSchool, students, type Student, type InsertStudent, donations, type Donation, type InsertDonation, events, type Event, type InsertEvent } from "@shared/schema";
import session from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // School operations
  getSchool(id: number): Promise<School | undefined>;
  getSchoolByUserId(userId: number): Promise<School | undefined>;
  getAllSchools(): Promise<School[]>;
  createSchool(school: InsertSchool): Promise<School>;
  
  // Student operations
  getStudent(id: number): Promise<Student | undefined>;
  getStudentByUserId(userId: number): Promise<Student | undefined>;
  getStudentsBySchoolId(schoolId: number): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
  
  // Donation operations
  getDonation(id: number): Promise<Donation | undefined>;
  getDonationsByStudentId(studentId: number): Promise<Donation[]>;
  getDonationsBySchoolId(schoolId: number): Promise<Donation[]>;
  createDonation(donation: InsertDonation): Promise<Donation>;
  
  // Event operations
  getEvent(id: number): Promise<Event | undefined>;
  getEventsBySchoolId(schoolId: number): Promise<Event[]>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event | undefined>;
  deleteEvent(id: number): Promise<boolean>;
  
  // School stats
  getSchoolStats(schoolId: number): Promise<{
    totalRaised: number;
    totalDonations: number;
    activeStudents: number;
  }>;
  
  // Student stats
  getStudentStats(studentId: number): Promise<{
    totalRaised: number;
    totalDonations: number;
    largestDonation: number;
    averageDonation: number;
  }>;
  
  // Top performing students
  getTopPerformingStudents(schoolId: number, limit?: number): Promise<Array<Student & {amountRaised: number, goalProgress: number}>>;
  
  // Session store
  sessionStore: session.SessionStore;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private schools: Map<number, School>;
  private students: Map<number, Student>;
  private donations: Map<number, Donation>;
  private events: Map<number, Event>;
  
  userCurrentId: number;
  schoolCurrentId: number;
  studentCurrentId: number;
  donationCurrentId: number;
  eventCurrentId: number;
  sessionStore: session.SessionStore;

  constructor() {
    this.users = new Map();
    this.schools = new Map();
    this.students = new Map();
    this.donations = new Map();
    this.events = new Map();
    
    this.userCurrentId = 1;
    this.schoolCurrentId = 1;
    this.studentCurrentId = 1;
    this.donationCurrentId = 1;
    this.eventCurrentId = 1;
    
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000,
    });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const createdAt = new Date();
    const user: User = { ...insertUser, id, createdAt };
    this.users.set(id, user);
    return user;
  }
  
  // School operations
  async getSchool(id: number): Promise<School | undefined> {
    return this.schools.get(id);
  }
  
  async getSchoolByUserId(userId: number): Promise<School | undefined> {
    return Array.from(this.schools.values()).find(
      (school) => school.userId === userId,
    );
  }
  
  async getAllSchools(): Promise<School[]> {
    return Array.from(this.schools.values());
  }
  
  async createSchool(insertSchool: InsertSchool): Promise<School> {
    const id = this.schoolCurrentId++;
    const createdAt = new Date();
    const school: School = { ...insertSchool, id, createdAt };
    this.schools.set(id, school);
    return school;
  }
  
  // Student operations
  async getStudent(id: number): Promise<Student | undefined> {
    return this.students.get(id);
  }
  
  async getStudentByUserId(userId: number): Promise<Student | undefined> {
    return Array.from(this.students.values()).find(
      (student) => student.userId === userId,
    );
  }
  
  async getStudentsBySchoolId(schoolId: number): Promise<Student[]> {
    return Array.from(this.students.values()).filter(
      (student) => student.schoolId === schoolId,
    );
  }
  
  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const id = this.studentCurrentId++;
    const createdAt = new Date();
    const student: Student = { ...insertStudent, id, createdAt };
    this.students.set(id, student);
    return student;
  }
  
  // Donation operations
  async getDonation(id: number): Promise<Donation | undefined> {
    return this.donations.get(id);
  }
  
  async getDonationsByStudentId(studentId: number): Promise<Donation[]> {
    return Array.from(this.donations.values()).filter(
      (donation) => donation.studentId === studentId,
    );
  }
  
  async getDonationsBySchoolId(schoolId: number): Promise<Donation[]> {
    // Get all students in this school
    const schoolStudents = await this.getStudentsBySchoolId(schoolId);
    const studentIds = schoolStudents.map(student => student.id);
    
    // Get donations for these students
    return Array.from(this.donations.values()).filter(
      (donation) => studentIds.includes(donation.studentId),
    );
  }
  
  async createDonation(insertDonation: InsertDonation): Promise<Donation> {
    const id = this.donationCurrentId++;
    const createdAt = new Date();
    const donation: Donation = { ...insertDonation, id, createdAt };
    this.donations.set(id, donation);
    return donation;
  }
  
  // School stats
  async getSchoolStats(schoolId: number): Promise<{
    totalRaised: number;
    totalDonations: number;
    activeStudents: number;
  }> {
    const schoolStudents = await this.getStudentsBySchoolId(schoolId);
    const studentIds = schoolStudents.map(student => student.id);
    
    const allDonations = Array.from(this.donations.values()).filter(
      (donation) => studentIds.includes(donation.studentId),
    );
    
    const totalRaised = allDonations.reduce((sum, donation) => 
      sum + Number(donation.amount), 0);
    
    return {
      totalRaised,
      totalDonations: allDonations.length,
      activeStudents: schoolStudents.length,
    };
  }
  
  // Student stats
  async getStudentStats(studentId: number): Promise<{
    totalRaised: number;
    totalDonations: number;
    largestDonation: number;
    averageDonation: number;
  }> {
    const studentDonations = await this.getDonationsByStudentId(studentId);
    
    const totalRaised = studentDonations.reduce((sum, donation) => 
      sum + Number(donation.amount), 0);
    
    const largestDonation = studentDonations.length > 0 
      ? Math.max(...studentDonations.map(d => Number(d.amount)))
      : 0;
    
    const averageDonation = studentDonations.length > 0
      ? totalRaised / studentDonations.length
      : 0;
    
    return {
      totalRaised,
      totalDonations: studentDonations.length,
      largestDonation,
      averageDonation,
    };
  }
  
  // Top performing students
  async getTopPerformingStudents(schoolId: number, limit: number = 10): Promise<Array<Student & {amountRaised: number, goalProgress: number}>> {
    const schoolStudents = await this.getStudentsBySchoolId(schoolId);
    
    // Calculate amount raised for each student
    const studentsWithProgress = await Promise.all(
      schoolStudents.map(async (student) => {
        const stats = await this.getStudentStats(student.id);
        return {
          ...student,
          amountRaised: stats.totalRaised,
          goalProgress: student.personalGoal 
            ? Math.round((stats.totalRaised / Number(student.personalGoal)) * 100) 
            : 0,
        };
      })
    );
    
    // Sort by amount raised in descending order
    const sortedStudents = studentsWithProgress.sort((a, b) => 
      b.amountRaised - a.amountRaised
    );
    
    return sortedStudents.slice(0, limit);
  }
  
  // Event operations
  async getEvent(id: number): Promise<Event | undefined> {
    return this.events.get(id);
  }
  
  async getEventsBySchoolId(schoolId: number): Promise<Event[]> {
    return Array.from(this.events.values()).filter(
      (event) => event.schoolId === schoolId
    );
  }
  
  async createEvent(insertEvent: InsertEvent): Promise<Event> {
    const id = this.eventCurrentId++;
    const createdAt = new Date();
    const event: Event = { ...insertEvent, id, createdAt };
    this.events.set(id, event);
    return event;
  }
  
  async updateEvent(id: number, updateEvent: Partial<InsertEvent>): Promise<Event | undefined> {
    const existingEvent = await this.getEvent(id);
    if (!existingEvent) {
      return undefined;
    }
    
    const updatedEvent: Event = {
      ...existingEvent,
      ...updateEvent,
    };
    
    this.events.set(id, updatedEvent);
    return updatedEvent;
  }
  
  async deleteEvent(id: number): Promise<boolean> {
    const exists = await this.getEvent(id);
    if (!exists) {
      return false;
    }
    
    return this.events.delete(id);
  }
}

export const storage = new MemStorage();
